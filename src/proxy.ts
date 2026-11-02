import {NextResponse,type NextRequest} from 'next/server';
export function proxy(request:NextRequest){
  if(process.env.SALMON_DESKTOP==='true'&&(!process.env.SALMON_DESKTOP_TOKEN||request.headers.get('x-salmon-desktop-token')!==process.env.SALMON_DESKTOP_TOKEN))return new NextResponse('Forbidden',{status:403});
  return NextResponse.next();
}
