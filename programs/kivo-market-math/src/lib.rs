//! Integer quote engine for KIVO's proposed ten-tranche market.
//! No floating point or external state is used. The onchain program must
//! validate accounts and transfer assets; these pure functions do neither.

pub const TRANCHE_COUNT: usize = 10;
pub const CURVE_TOKENS: u64 = 800_000_000_000_000; // 80% of 1B, six decimals.
pub const TOTAL_TOKENS: u64 = 1_000_000_000_000_000;
pub const TRANCHE_TOKENS: u64 = CURVE_TOKENS / TRANCHE_COUNT as u64;
pub const BPS: u128 = 10_000;
pub const CURVE_FEE_BPS: u16 = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error { Overflow, InvalidRules, InvalidAmount, InsufficientReserve, Slippage, SoldOut, AlreadyGraduated, GuardCap }
pub type Result<T> = core::result::Result<T, Error>;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Rules {
    pub base_bps: u16,
    pub surge_ceiling_bps: u16,
    pub surge_sensitivity: u8,
    pub guard_slots: u32,
    pub guard_cap_bps: u16,
    pub snipe_tax_bps: u16,
    pub burn_bps: u16,
    pub lp_bps: u16,
    pub pot_bps: u16,
    pub pot_every: u32,
    pub pot_min_lamports: u64,
}

impl Rules {
    pub fn validate(&self) -> Result<()> {
        if self.base_bps > 300 || self.surge_ceiling_bps > 5_000 ||
            (self.surge_ceiling_bps != 0 && self.surge_ceiling_bps < self.base_bps) ||
            self.surge_sensitivity > 10 || self.guard_slots > 100_000 ||
            self.guard_cap_bps > 10_000 || self.snipe_tax_bps > 5_000 ||
            u32::from(self.base_bps) + u32::from(self.snipe_tax_bps) > 5_000 ||
            u32::from(self.burn_bps) + u32::from(self.lp_bps) + u32::from(self.pot_bps) > 1_000 ||
            (self.pot_every != 0 && !(2..=100_000).contains(&self.pot_every)) ||
            (self.pot_every == 0 && (self.pot_bps != 0 || self.pot_min_lamports != 0)) ||
            (self.pot_every != 0 && self.pot_min_lamports < 10_000_000) {
            return Err(Error::InvalidRules);
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Market {
    pub raise_lamports: u64,
    pub sold: u64,
    pub reserve: u64,
    pub creator_fees: u64,
    pub treasury_fees: u64,
    pub royalty_bps: u16,
    pub royalty_fees: u64,
    pub pot: u64,
    pub buy_count: u64,
    pub launch_slot: u64,
    pub last_guard_slot: u64,
    pub guard_bought_in_slot: u64,
    pub last_pot_slot: u64,
    pub graduated: bool,
    pub creator_first_buy_pending: bool,
}

impl Market {
    pub fn new(raise_lamports: u64, launch_slot: u64) -> Result<Self> {
        if !(500_000_000..=10_000_000_000_000).contains(&raise_lamports) { return Err(Error::InvalidAmount); }
        Ok(Self { raise_lamports, sold: 0, reserve: 0, creator_fees: 0, treasury_fees: 0,
            royalty_bps: 0, royalty_fees: 0, pot: 0, buy_count: 0,
            launch_slot, last_guard_slot: 0, guard_bought_in_slot: 0,
            last_pot_slot: 0, graduated: false, creator_first_buy_pending: true })
    }
}

fn ceil_div(n: u128, d: u128) -> Result<u128> {
    if d == 0 { return Err(Error::InvalidAmount); }
    Ok(n / d + u128::from(n % d != 0))
}
fn u64_checked(n: u128) -> Result<u64> { u64::try_from(n).map_err(|_| Error::Overflow) }
fn portion(n: u64, bps: u16) -> Result<u64> { u64_checked(ceil_div((n as u128).checked_mul(bps as u128).ok_or(Error::Overflow)?, BPS)?) }

fn weights() -> [u128; TRANCHE_COUNT] {
    // Exact 1.7^i ratios with a shared denominator of 10^9.
    let mut out = [0u128; TRANCHE_COUNT];
    let mut weight = 1_000_000_000u128;
    for entry in &mut out { *entry = weight; weight = weight * 17 / 10; }
    out
}

pub fn tranche_budgets(raise: u64) -> Result<[u64; TRANCHE_COUNT]> {
    let weights = weights();
    let total: u128 = weights.iter().sum();
    let mut result = [0u64; TRANCHE_COUNT];
    let mut allocated = 0u64;
    for i in 0..TRANCHE_COUNT - 1 {
        result[i] = u64_checked((raise as u128).checked_mul(weights[i]).ok_or(Error::Overflow)? / total)?;
        allocated = allocated.checked_add(result[i]).ok_or(Error::Overflow)?;
    }
    result[TRANCHE_COUNT - 1] = raise.checked_sub(allocated).ok_or(Error::Overflow)?;
    Ok(result)
}

fn cumulative_cost(offset: u64, budget: u64) -> Result<u64> {
    u64_checked(ceil_div((budget as u128).checked_mul(offset as u128).ok_or(Error::Overflow)?, TRANCHE_TOKENS as u128)?)
}

pub fn curve_cost(raise: u64, from: u64, to: u64) -> Result<u64> {
    if from > to || to > CURVE_TOKENS { return Err(Error::InvalidAmount); }
    let budgets = tranche_budgets(raise)?;
    let mut cost = 0u64;
    let mut position = from;
    while position < to {
        let tranche = (position / TRANCHE_TOKENS) as usize;
        let end = to.min((tranche as u64 + 1) * TRANCHE_TOKENS);
        let lower = cumulative_cost(position % TRANCHE_TOKENS, budgets[tranche])?;
        let upper = cumulative_cost(end - tranche as u64 * TRANCHE_TOKENS, budgets[tranche])?;
        cost = cost.checked_add(upper.checked_sub(lower).ok_or(Error::Overflow)?).ok_or(Error::Overflow)?;
        position = end;
    }
    Ok(cost)
}

fn surge_bps(rules: &Rules, trade: u64, depth: u64) -> Result<u16> {
    if rules.surge_ceiling_bps == 0 || rules.surge_sensitivity == 0 { return Ok(0); }
    let room = rules.surge_ceiling_bps.checked_sub(rules.base_bps).ok_or(Error::InvalidRules)?;
    let computed = (trade as u128).checked_mul(rules.surge_sensitivity as u128).ok_or(Error::Overflow)?
        .checked_mul(room as u128).ok_or(Error::Overflow)? / (depth.max(1) as u128);
    Ok((room as u128).min(computed) as u16)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BuyQuote {
    pub gross_tokens: u64,
    pub delivered_tokens: u64,
    pub burned_tokens: u64,
    pub principal: u64,
    pub fee: u64,
    pub lp_cut: u64,
    pub pot_cut: u64,
    pub total_payment: u64,
    pub pot_payout: u64,
    pub next: Market,
}

pub fn quote_buy(market: Market, rules: Rules, gross_tokens: u64, slot: u64, is_creator: bool) -> Result<BuyQuote> {
    rules.validate()?;
    if market.royalty_bps > 1_000 || (market.royalty_bps>0 && rules.lp_bps==0 && rules.pot_bps==0) {
        return Err(Error::InvalidRules);
    }
    if market.graduated { return Err(Error::AlreadyGraduated); }
    if gross_tokens == 0 { return Err(Error::InvalidAmount); }
    let new_sold = market.sold.checked_add(gross_tokens).ok_or(Error::Overflow)?;
    if new_sold > CURVE_TOKENS { return Err(Error::SoldOut); }
    if slot < market.launch_slot { return Err(Error::InvalidAmount); }
    let guarded = slot - market.launch_slot < rules.guard_slots as u64;
    let bought_this_slot = if slot == market.last_guard_slot { market.guard_bought_in_slot } else { 0 };
    if guarded && rules.guard_cap_bps != 0 &&
        bought_this_slot.checked_add(gross_tokens).ok_or(Error::Overflow)? >
        (TOTAL_TOKENS as u128 * rules.guard_cap_bps as u128 / BPS) as u64 { return Err(Error::GuardCap); }
    let principal = curve_cost(market.raise_lamports, market.sold, new_sold)?;
    let surge = surge_bps(&rules, principal, market.raise_lamports)?;
    let tax = if guarded && !(is_creator && market.creator_first_buy_pending && slot == market.launch_slot) { rules.snipe_tax_bps } else { 0 };
    let fee_bps = u32::from(CURVE_FEE_BPS) + u32::from(rules.base_bps) + u32::from(surge) + u32::from(tax);
    let fee = u64_checked(ceil_div((principal as u128).checked_mul(fee_bps as u128).ok_or(Error::Overflow)?, BPS)?)?;
    let curve_fee = portion(principal, CURVE_FEE_BPS)?;
    let lp_cut = portion(principal, rules.lp_bps)?;
    let pot_cut = portion(principal, rules.pot_bps)?;
    let royalty_lp = (lp_cut as u128 * market.royalty_bps as u128 / BPS) as u64;
    let royalty_pot = (pot_cut as u128 * market.royalty_bps as u128 / BPS) as u64;
    let burned_tokens = u64_checked(gross_tokens as u128 * rules.burn_bps as u128 / BPS)?;
    let delivered_tokens = gross_tokens.checked_sub(burned_tokens).ok_or(Error::Overflow)?;
    let total_payment = principal.checked_add(fee).and_then(|n| n.checked_add(lp_cut)).and_then(|n| n.checked_add(pot_cut)).ok_or(Error::Overflow)?;
    let mut next = market;
    next.sold = new_sold;
    next.reserve = next.reserve.checked_add(principal).and_then(|n| n.checked_add(fee)).and_then(|n| n.checked_add(lp_cut)).ok_or(Error::Overflow)?;
    next.creator_fees = next.creator_fees.checked_add(curve_fee - curve_fee / 2).ok_or(Error::Overflow)?;
    next.treasury_fees = next.treasury_fees.checked_add(curve_fee / 2).ok_or(Error::Overflow)?;
    next.pot = next.pot.checked_add(pot_cut-royalty_pot).ok_or(Error::Overflow)?;
    next.reserve = next.reserve.checked_add(royalty_pot).ok_or(Error::Overflow)?;
    next.royalty_fees=next.royalty_fees.checked_add(royalty_lp)
        .and_then(|n|n.checked_add(royalty_pot)).ok_or(Error::Overflow)?;
    if guarded { next.last_guard_slot = slot; next.guard_bought_in_slot = bought_this_slot.checked_add(gross_tokens).ok_or(Error::Overflow)?; }
    if is_creator && market.creator_first_buy_pending { next.creator_first_buy_pending = false; }
    let mut pot_payout = 0;
    if rules.pot_every != 0 && principal >= rules.pot_min_lamports && (slot != market.last_pot_slot || market.buy_count == 0) {
        next.last_pot_slot = slot;
        next.buy_count = next.buy_count.checked_add(1).ok_or(Error::Overflow)?;
        if next.buy_count % rules.pot_every as u64 == 0 { pot_payout = next.pot; next.pot = 0; }
    }
    next.graduated = new_sold == CURVE_TOKENS;
    Ok(BuyQuote { gross_tokens, delivered_tokens, burned_tokens, principal, fee, lp_cut, pot_cut, total_payment, pot_payout, next })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SellQuote { pub tokens: u64, pub principal: u64, pub fee: u64, pub payout: u64, pub next: Market }

pub fn quote_sell(market: Market, rules: Rules, tokens: u64) -> Result<SellQuote> {
    rules.validate()?;
    if market.graduated { return Err(Error::AlreadyGraduated); }
    if tokens == 0 || tokens > market.sold { return Err(Error::InvalidAmount); }
    let new_sold = market.sold - tokens;
    let principal = curve_cost(market.raise_lamports, new_sold, market.sold)?;
    let surge = surge_bps(&rules, tokens, market.sold)?;
    let fee = u64_checked(ceil_div(principal as u128 * (CURVE_FEE_BPS as u128 + rules.base_bps as u128 + surge as u128), BPS)?)?;
    let curve_fee = portion(principal, CURVE_FEE_BPS)?;
    let payout = principal.checked_sub(fee).ok_or(Error::InvalidAmount)?;
    if payout > market.reserve { return Err(Error::InsufficientReserve); }
    let mut next = market;
    next.sold = new_sold;
    next.reserve -= payout;
    next.creator_fees = next.creator_fees.checked_add(curve_fee - curve_fee / 2).ok_or(Error::Overflow)?;
    next.treasury_fees = next.treasury_fees.checked_add(curve_fee / 2).ok_or(Error::Overflow)?;
    Ok(SellQuote { tokens, principal, fee, payout, next })
}

pub fn claim_fees(market: Market, creator_side: bool) -> Result<(u64, Market)> {
    let amount = if creator_side { market.creator_fees } else { market.treasury_fees };
    if amount == 0 { return Ok((0, market)); }
    let mut next = market;
    next.reserve = next.reserve.checked_sub(amount).ok_or(Error::InsufficientReserve)?;
    if !next.graduated && next.reserve < curve_cost(next.raise_lamports, 0, next.sold)? { return Err(Error::InsufficientReserve); }
    if creator_side { next.creator_fees = 0; } else { next.treasury_fees = 0; }
    Ok((amount, next))
}

pub fn claim_royalty(market: Market) -> Result<(u64, Market)> {
    let mut next=market;
    next.reserve=next.reserve.checked_sub(next.royalty_fees).ok_or(Error::InsufficientReserve)?;
    if !next.graduated && next.reserve<curve_cost(next.raise_lamports,0,next.sold)? {
        return Err(Error::InsufficientReserve);
    }
    next.royalty_fees=0;
    Ok((market.royalty_fees,next))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn full_curve_cost_is_target_and_prices_climb() {
        let target = 85_000_000_000;
        assert_eq!(curve_cost(target, 0, CURVE_TOKENS), Ok(target));
        let costs: Vec<_> = (0..10).map(|i| curve_cost(target, i * TRANCHE_TOKENS, (i+1) * TRANCHE_TOKENS).unwrap()).collect();
        assert!(costs.windows(2).all(|pair| pair[1] > pair[0]));
    }

    #[test]
    fn splits_at_tranches_are_additive() {
        let a = TRANCHE_TOKENS - 123_456;
        let b = TRANCHE_TOKENS + 982_733;
        let m = TRANCHE_TOKENS;
        assert_eq!(curve_cost(85_000_000_000, a, b).unwrap(),
                   curve_cost(85_000_000_000, a, m).unwrap() + curve_cost(85_000_000_000, m, b).unwrap());
    }

    #[test]
    fn buy_sell_reserve_covers_refund() {
        let rules = Rules { base_bps: 30, burn_bps: 100, lp_bps: 25, pot_bps: 50, pot_every: 2,
            pot_min_lamports: 10_000_000, ..Default::default() };
        let initial = Market::new(85_000_000_000, 100).unwrap();
        let first = quote_buy(initial, rules, 2_000_000_000_000, 101, false).unwrap();
        assert!(first.next.reserve >= first.principal);
        let sell = quote_sell(first.next, rules, first.delivered_tokens).unwrap();
        assert!(sell.payout <= first.principal);
        assert!(sell.next.reserve < first.next.reserve);
    }

    #[test]
    fn pot_cannot_advance_twice_in_slot() {
        let rules = Rules { pot_bps: 100, pot_every: 2, pot_min_lamports: 10_000_000, ..Default::default() };
        let m = Market::new(85_000_000_000, 100).unwrap();
        let a = quote_buy(m, rules, TRANCHE_TOKENS, 101, false).unwrap();
        let b = quote_buy(a.next, rules, TRANCHE_TOKENS, 101, false).unwrap();
        assert_eq!(b.next.buy_count, 1);
        let c = quote_buy(b.next, rules, TRANCHE_TOKENS, 102, false).unwrap();
        assert_eq!(c.next.buy_count, 2);
        assert!(c.pot_payout > 0);
        assert_eq!(c.next.pot, 0);
    }

    #[test]
    fn guard_caps_slot_total() {
        let rules = Rules { guard_slots: 10, guard_cap_bps: 100, ..Default::default() };
        let m = Market::new(85_000_000_000, 100).unwrap();
        let cap = TOTAL_TOKENS / 100;
        let a = quote_buy(m, rules, cap / 2, 101, false).unwrap();
        assert_eq!(quote_buy(a.next, rules, cap / 2 + 1, 101, false), Err(Error::GuardCap));
        assert!(quote_buy(a.next, rules, cap, 102, false).is_ok());
    }

    #[test]
    fn reserve_covers_curve_liability_across_mixed_trades() {
        let rules = Rules { base_bps: 30, surge_ceiling_bps: 300, surge_sensitivity: 5,
            burn_bps: 100, lp_bps: 25, pot_bps: 50, pot_every: 7,
            pot_min_lamports: 10_000_000, ..Default::default() };
        let mut market = Market::new(85_000_000_000, 1).unwrap();
        let mut circulating = 0u64;
        let mut seed = 73u64;
        for slot in 2..1_000 {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
            let buy = seed % 3 != 0 || circulating == 0;
            if buy {
                let amount = (seed % 5_000_000_000_000).max(1).min(CURVE_TOKENS - market.sold);
                if amount == 0 { break; }
                let quote = quote_buy(market, rules, amount, slot, false).unwrap();
                circulating += quote.delivered_tokens;
                market = quote.next;
            } else {
                let amount = (seed % circulating).max(1).min(market.sold);
                let quote = quote_sell(market, rules, amount).unwrap();
                circulating -= amount;
                market = quote.next;
            }
            assert!(market.reserve >= curve_cost(market.raise_lamports, 0, market.sold).unwrap());
            if slot % 11 == 0 {
                market = claim_fees(market, true).unwrap().1;
                market = claim_fees(market, false).unwrap().1;
                assert!(market.reserve >= curve_cost(market.raise_lamports, 0, market.sold).unwrap());
            }
        }
    }

    #[test]
    fn blueprint_royalty_is_claimable_without_draining_curve() {
        let rules=Rules {lp_bps:100,pot_bps:100,pot_every:2,pot_min_lamports:10_000_000,..Default::default()};
        let mut market=Market::new(85_000_000_000,1).unwrap();
        market.royalty_bps=1_000;
        let buy=quote_buy(market,rules,TRANCHE_TOKENS,2,false).unwrap();
        assert!(buy.next.royalty_fees>0);
        assert!(buy.next.pot<buy.pot_cut);
        let (paid,next)=claim_royalty(buy.next).unwrap();
        assert_eq!(paid,buy.next.royalty_fees);
        assert!(next.reserve>=curve_cost(next.raise_lamports,0,next.sold).unwrap());
    }
}
