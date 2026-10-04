import Kivo from '../site';
import { publicConfig } from '../../lib/site-config';
export const dynamic = 'force-dynamic';
export default async function Page({params}:{params:Promise<{slug:string[]}>}){ const {slug}=await params; return <Kivo initialPage={slug[0]||'home'} config={await publicConfig()}/> }
