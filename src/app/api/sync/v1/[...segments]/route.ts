import {AppError} from '@/lib/model';
import {fail} from '@/lib/http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
function retired(){return fail(new AppError('桌面同步已停用，请在网站后台编辑',410));}
export const GET=retired,POST=retired,PUT=retired,HEAD=retired,DELETE=retired;
