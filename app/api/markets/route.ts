import {Connection} from '@solana/web3.js';
import {marketProgram,parseMarket} from '../../../lib/market-client';
import {rpc,type SolanaNetwork} from '../../../lib/solana-launch';

export async function GET(){
  try{
    const network:SolanaNetwork=process.env.NEXT_PUBLIC_KIVO_NETWORK==='mainnet-beta'?'mainnet-beta':'devnet';
    const connection=new Connection(process.env.SOLANA_MARKET_RPC||rpc(network),'confirmed');
    const accounts=await connection.getProgramAccounts(marketProgram(),{commitment:'confirmed',filters:[
      {dataSize:513},{memcmp:{offset:0,bytes:'15kojcfUoL5'}},
    ]});
    const markets=accounts.slice(0,100).map(({pubkey,account})=>{
      const m=parseMarket(account.data,pubkey);
      return {mint:m.mint.toBase58(),market:m.address.toBase58(),creator:m.creator.toBase58(),
        sold:m.sold.toString(),raise:m.raise.toString(),graduated:m.graduated,migrated:m.migrated,
        pool:m.migrated?m.pool.toBase58():null};
    });
    return Response.json({network,markets},{headers:{'Cache-Control':'public, max-age=5'}});
  }catch(e){return Response.json({error:e instanceof Error?e.message:'Market lookup failed.'},{status:503});}
}
