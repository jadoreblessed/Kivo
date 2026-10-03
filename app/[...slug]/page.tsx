import Kivo from '../site';
export default async function Page({params}:{params:Promise<{slug:string[]}>}){ const {slug}=await params; return <Kivo initialPage={slug[0]||'home'}/> }
