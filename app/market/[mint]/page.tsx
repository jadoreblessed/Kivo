import MarketScreen from '../../market-screen';

export default async function Page({params}:{params:Promise<{mint:string}>}) {
  const {mint}=await params;
  return <MarketScreen mintAddress={mint}/>;
}
