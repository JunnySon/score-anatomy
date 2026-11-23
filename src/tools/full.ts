import { HistoryExtras } from '../screens/HistoryExtras';
import { InputRows } from '../screens/InputRows';
import { TestAdmin } from '../screens/TestAdmin';
import type { Tools } from './types';

// 일반 웹 빌드와 앱 시험용 묶음: 사용성 테스트 도구를 모두 싣는다.
export const tools: Tools = { enabled: true, TestAdmin, InputRows, HistoryExtras };
