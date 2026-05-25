import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.PORT || 3000;
const NEIS_API_KEY = process.env.NEIS_API_KEY;
const DATA_DIR = path.join(process.cwd(), 'data');
const USER_FILE = path.join(DATA_DIR, 'users.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(USER_FILE)) fs.writeFileSync(USER_FILE, '{}', 'utf8');

const allergyMap = {
  '1': '난류', '2': '우유', '3': '메밀', '4': '땅콩', '5': '대두', '6': '밀', '7': '고등어', '8': '게', '9': '새우', '10': '돼지고기',
  '11': '복숭아', '12': '토마토', '13': '아황산류', '14': '호두', '15': '닭고기', '16': '쇠고기', '17': '오징어', '18': '조개류', '19': '잣'
};

function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USER_FILE, 'utf8')); }
  catch { return {}; }
}

function saveUsers(users) {
  fs.writeFileSync(USER_FILE, JSON.stringify(users, null, 2), 'utf8');
}

function kakaoText(text, quickReplies = []) {
  return {
    version: '2.0',
    template: {
      outputs: [{ simpleText: { text: String(text).slice(0, 980) } }],
      quickReplies: quickReplies.map(label => ({ label, action: 'message', messageText: label }))
    }
  };
}

function getUserId(body) {
  return body?.userRequest?.user?.id || body?.userRequest?.user?.properties?.plusfriendUserKey || 'anonymous';
}

function getUtterance(body) {
  return (body?.userRequest?.utterance || '').trim();
}

function ymd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function displayDate(date) {
  const days = ['일','월','화','수','목','금','토'];
  return `${date.getMonth()+1}/${date.getDate()}(${days[date.getDay()]})`;
}

function addDays(date, n) {
  const d = new Date(date); d.setDate(d.getDate() + n); return d;
}

function mondayOf(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function cleanMenu(text = '') {
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\([0-9.]+\)/g, '')
    .replace(/\*/g, '')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);
}

function extractAllergyNames(text = '') {
  const nums = [...text.matchAll(/\(([0-9.]+)\)/g)]
    .flatMap(m => m[1].split('.'))
    .filter(Boolean);
  return [...new Set(nums.map(n => allergyMap[n]).filter(Boolean))];
}

async function neisGet(endpoint, params) {
  if (!NEIS_API_KEY) throw new Error('NEIS_API_KEY 환경변수가 설정되지 않았습니다.');
  const url = new URL(`https://open.neis.go.kr/hub/${endpoint}`);
  url.searchParams.set('KEY', NEIS_API_KEY);
  url.searchParams.set('Type', 'json');
  url.searchParams.set('pIndex', '1');
  url.searchParams.set('pSize', '20');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  const data = await res.json();
  return data;
}

async function searchSchools(name) {
  const data = await neisGet('schoolInfo', { SCHUL_NM: name });
  const rows = data?.schoolInfo?.[1]?.row || [];
  return rows.map(r => ({
    name: r.SCHUL_NM,
    region: r.LCTN_SC_NM || '',
    officeCode: r.ATPT_OFCDC_SC_CODE,
    schoolCode: r.SD_SCHUL_CODE,
    address: r.ORG_RDNMA || ''
  }));
}

async function getMeal(school, date) {
  const data = await neisGet('mealServiceDietInfo', {
    ATPT_OFCDC_SC_CODE: school.officeCode,
    SD_SCHUL_CODE: school.schoolCode,
    MLSV_YMD: ymd(date)
  });
  const rows = data?.mealServiceDietInfo?.[1]?.row || [];
  const lunch = rows.find(r => (r.MMEAL_SC_NM || '').includes('중식')) || rows[0];
  if (!lunch) return null;
  const raw = lunch.DDISH_NM || '';
  return {
    menu: cleanMenu(raw),
    allergies: extractAllergyNames(raw),
    calorie: lunch.CAL_INFO || '',
    mealName: lunch.MMEAL_SC_NM || '급식'
  };
}

function recommendDinner(menu = []) {
  const joined = menu.join(' ');
  if (/튀김|돈가스|치킨|너겟|탕수|강정/.test(joined)) {
    return {
      reason: '점심에 튀김·고기류가 있어요. 저녁은 가볍게 구성해보세요.',
      dinners: ['두부샐러드', '계란찜', '닭가슴살 채소볶음'],
      shopping: ['두부', '계란', '닭가슴살', '양상추', '오이', '방울토마토']
    };
  }
  if (/국수|라면|우동|스파게티|파스타|빵/.test(joined)) {
    return {
      reason: '점심에 면·빵류가 있어요. 저녁은 밥과 단백질, 채소를 챙기면 좋아요.',
      dinners: ['소고기채소덮밥', '두부된장국', '시금치나물'],
      shopping: ['쌀', '소고기', '두부', '된장', '시금치', '양파']
    };
  }
  if (/비빔밥|나물|샐러드|채소/.test(joined)) {
    return {
      reason: '점심에 채소가 포함되어 있어요. 저녁은 단백질을 보충해보세요.',
      dinners: ['생선구이', '닭안심구이', '달걀말이'],
      shopping: ['생선', '닭안심', '달걀', '대파', '브로콜리']
    };
  }
  return {
    reason: '점심 급식과 겹치지 않게 무난한 저녁 메뉴를 추천했어요.',
    dinners: ['두부부침', '닭가슴살 채소볶음', '계란국'],
    shopping: ['두부', '닭가슴살', '계란', '양파', '대파', '애호박']
  };
}

function formatMeal(schoolName, date, meal, role) {
  if (!meal) return `🍱 ${schoolName} ${displayDate(date)} 급식 정보가 없습니다.\n방학, 재량휴업일, 급식 미실시일일 수 있어요.`;
  let text = `🍱 ${schoolName} ${displayDate(date)} ${meal.mealName}\n\n`;
  text += meal.menu.join('\n');
  if (meal.calorie) text += `\n\n🔥 ${meal.calorie}`;
  if (meal.allergies.length) text += `\n⚠️ 알레르기: ${meal.allergies.join(', ')}`;
  if (role === '학부모') {
    const rec = recommendDinner(meal.menu);
    text += `\n\n🍽️ 저녁 추천\n${rec.reason}\n- ${rec.dinners.join('\n- ')}`;
    text += `\n\n🛒 장보기\n${rec.shopping.join(', ')}`;
  }
  return text;
}

async function formatWeekMeal(school) {
  const mon = mondayOf(new Date());
  const lines = [`📅 ${school.name} 이번 주 급식표`];
  for (let i = 0; i < 5; i++) {
    const d = addDays(mon, i);
    const meal = await getMeal(school, d);
    if (!meal) lines.push(`\n${displayDate(d)}\n급식 정보 없음`);
    else lines.push(`\n${displayDate(d)}\n${meal.menu.slice(0, 6).join(' / ')}`);
  }
  return lines.join('\n');
}

function help(user) {
  if (!user?.school) {
    return '🍱 급식톡 사용 방법\n\n먼저 학교를 등록해주세요.\n예: 학교등록 백양고등학교\n\n등록 후 사용할 수 있는 말\n오늘 / 내일 / 이번주 / 학교변경';
  }
  return `🍱 급식톡 사용 방법\n\n등록 학교: ${user.school.name}\n사용자 유형: ${user.role || '미설정'}\n\n사용 가능한 말\n오늘 / 내일 / 이번주 / 학교변경 / 설정`;
}

app.get('/', (req, res) => res.send('GeupsikTalk Kakao Skill Server is running.'));
app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/skill', async (req, res) => {
  try {
    const users = loadUsers();
    const userId = getUserId(req.body);
    const utterance = getUtterance(req.body);
    const user = users[userId] || {};

    if (!utterance || /^(시작|처음|도움말|설정|메뉴)$/i.test(utterance)) {
      return res.json(kakaoText(help(user), ['오늘', '내일', '이번주', '학교등록']));
    }

    if (/^(학교변경|학교 바꾸기|다시등록|초기화)$/.test(utterance)) {
      delete users[userId]; saveUsers(users);
      return res.json(kakaoText('학교 정보를 초기화했어요.\n다시 등록하려면 “학교등록 학교명”으로 입력해주세요.\n예: 학교등록 백양고등학교'));
    }

    const schoolMatch = utterance.match(/^학교\s*등록\s+(.+)$/) || utterance.match(/^학교등록\s+(.+)$/);
    if (schoolMatch) {
      const keyword = schoolMatch[1].trim();
      const schools = await searchSchools(keyword);
      if (!schools.length) return res.json(kakaoText(`“${keyword}”로 검색된 학교가 없어요.\n학교명을 다시 확인해주세요.`));
      user.pendingSchools = schools.slice(0, 5);
      users[userId] = user; saveUsers(users);
      if (schools.length === 1) {
        user.school = schools[0];
        user.pendingSchools = null;
        user.waitingRole = true;
        users[userId] = user; saveUsers(users);
        return res.json(kakaoText(`${schools[0].region} ${schools[0].name}로 찾았어요.\n어떤 사용자로 이용하시나요?`, ['학생', '학부모']));
      }
      const text = ['아래 학교 중 선택해주세요.'];
      user.pendingSchools.forEach((s, i) => text.push(`${i+1}. ${s.region} ${s.name}`));
      text.push('\n예: 1번');
      return res.json(kakaoText(text.join('\n'), ['1번', '2번', '3번']));
    }

    const numMatch = utterance.match(/^([1-5])번?$/);
    if (numMatch && user.pendingSchools) {
      const selected = user.pendingSchools[Number(numMatch[1]) - 1];
      if (!selected) return res.json(kakaoText('선택 번호를 다시 확인해주세요.'));
      user.school = selected;
      user.pendingSchools = null;
      user.waitingRole = true;
      users[userId] = user; saveUsers(users);
      return res.json(kakaoText(`${selected.region} ${selected.name}로 등록할게요.\n어떤 사용자로 이용하시나요?`, ['학생', '학부모']));
    }

    if (/^(학생|학부모)$/.test(utterance) && user.waitingRole) {
      user.role = utterance;
      user.waitingRole = false;
      users[userId] = user; saveUsers(users);
      return res.json(kakaoText(`${user.school.name} / ${utterance}으로 등록했어요.\n이제 “오늘”, “내일”, “이번주”라고 입력하면 급식을 볼 수 있어요.`, ['오늘', '내일', '이번주']));
    }

    if (!user.school) {
      return res.json(kakaoText('먼저 학교를 등록해주세요.\n예: 학교등록 백양고등학교', ['학교등록']));
    }

    if (/^(오늘|오늘급식|급식|오늘 급식)$/.test(utterance)) {
      const meal = await getMeal(user.school, new Date());
      return res.json(kakaoText(formatMeal(user.school.name, new Date(), meal, user.role), ['내일', '이번주', '학교변경']));
    }

    if (/^(내일|내일급식|내일 급식)$/.test(utterance)) {
      const d = addDays(new Date(), 1);
      const meal = await getMeal(user.school, d);
      return res.json(kakaoText(formatMeal(user.school.name, d, meal, user.role), ['오늘', '이번주', '학교변경']));
    }

    if (/^(이번주|이번 주|주간급식|이번주 급식|이번 주 급식)$/.test(utterance)) {
      const text = await formatWeekMeal(user.school);
      return res.json(kakaoText(text, ['오늘', '내일', '학교변경']));
    }

    if (/^(저녁추천|장보기)$/.test(utterance)) {
      const meal = await getMeal(user.school, new Date());
      if (!meal) return res.json(kakaoText('오늘 급식 정보가 없어 저녁 추천을 만들 수 없어요.'));
      const rec = recommendDinner(meal.menu);
      return res.json(kakaoText(`🍽️ 저녁 추천\n${rec.reason}\n\n- ${rec.dinners.join('\n- ')}\n\n🛒 장보기\n${rec.shopping.join(', ')}`, ['오늘', '이번주']));
    }

    return res.json(kakaoText('제가 알아듣지 못했어요.\n아래처럼 입력해보세요.\n\n오늘 / 내일 / 이번주 / 학교등록 학교명 / 학교변경', ['오늘', '내일', '이번주', '설정']));
  } catch (err) {
    console.error(err);
    return res.json(kakaoText(`처리 중 오류가 발생했어요.\n${err.message || '잠시 후 다시 시도해주세요.'}`));
  }
});

app.listen(PORT, () => console.log(`GeupsikTalk skill server running on port ${PORT}`));
