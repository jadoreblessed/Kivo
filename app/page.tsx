import Kivo from './site';
import { publicConfig } from '../lib/site-config';
export const dynamic = 'force-dynamic';
export default async function Page(){ return <Kivo config={await publicConfig()}/> }
