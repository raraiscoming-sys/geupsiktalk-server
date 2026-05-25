const express = require('express');

const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 3000;
const NEIS_API_KEY = process.env.NEIS_API_KEY;

// Prototype user store. Render free instances can restart, so this is not permanent.
// Later, replace this with a real DB such as Supabase/Firebase/Redis.
const users = new Map();

const ALLERGIES = {
  '1': '난류', '2': '우유', '3': '메밀', '4': '땅콩', '5': '대두',
  '6': '밀', '7': '고등어', '8': '게', '9': '새우', '10': '돼지고기',
  '11': '복숭아', '12': '토마토', '13': '아황산류', '14': '호두',
  '15': '닭고기', '16': '쇠고기', '17': '오징어', '18': '조개류', '19': '잣'
};

function kakaoText(text) {
  const trimmed = String(text || '').slice(0, 950);
  return {
    version: '2.0',
    template: {
      outputs: [
        {
          simpleText: {
            text: trimmed || '처리할 수 없는 요청입니다.'
          }
        }
      ]
    }
  };
}

function getUserId(body) {
  return body?.userRequest?.user?.id || body?.userRequest?.user?.properties?.botUserKey || 'anonymous';
}

function getUtterance(body) {
  return (body?.userRequest?.utterance || '').trim();
}

function todayKST(offsetDays = 0) {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  kst.setUTCDate(kst.getUTCDate() + offsetDays);
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kst.getUTCDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function formatKoreanDate(yyyymmdd) {
  return `${yyyymmdd.slice(0, 4)}.${yyyymmdd.slice(4, 6)}.${yyyymmdd.slice(6, 8)}`;
}

function getWeekDatesKST() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay(); // Sun 0, Mon 1
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const result = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(kst);
    d.setUTCDate(kst.getUTCDate() + diffToMonday + i);
    result.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`);
  }
  return result;
}

function stripHtmlMeal(text) {
  if (!text) return '';
  return String(text)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function extractAllergyNumbers(rawMenu) {
  const matches = String(rawMenu || '').match(/\(([^)]*)\)/g) || [];
  const nums = new Set();
  matches.forEach(part => {
    const found = part.match(/\d+/g) || [];
    found.forEach(n => nums.add(n));
  });
  return [...nums].sort((a, b) => Number(a) - Number(b));
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function searchSchool(name) {
  if (!NEIS_API_KEY) throw new Error('NEIS_API_KEY is missing');
  const url = new URL('https://open.neis.go.kr/hub/schoolInfo');
  url.searchParams.set('KEY', NEIS_API_KEY);
  url.searchParams.set('Type', 'json');
  url.searchParams.set('pIndex', '1');
  url.searchParams.set('pSize', '5');
  url.searchParams.set('SCHUL_NM', name);
  const data = await fetchJson(url);
  const rows = data?.schoolInfo?.[1]?.row || [];
  return rows.map(r => ({
    name: r.SCHUL_NM,
    officeCode: r.ATPT_OFCDC_SC_CODE,
    schoolCode: r.SD_SCHUL_CODE,
    officeName: r.ATPT_OFCDC_SC_NM,
    address: r.ORG_RDNMA
  }));
}

async function getMeal(school, yyyymmdd) {
  if (!NEIS_API_KEY) throw new Error('NEIS_API_KEY is missing');
  const url = new URL('https://open.neis.go.kr/hub/mealServiceDietInfo');
  url.searchParams.set('KEY', NEIS_API_KEY);
  url.searchParams.set('Type', 'json');
  url.searchParams.set('pIndex', '1');
  url.searchParams.set('pSize', '10');
  url.searchParams.set('ATPT_OFCDC_SC_CODE', school.officeCode);
  url.searchParams.set('SD_SCHUL_CODE', school.schoolCode);
  url.searchParams.set('MLSV_YMD', yyyymmdd);
  const data = await fetchJson(url);
  const rows = data?.mealServiceDietInfo?.[1]?.row || [];
  const lunch = rows.find(r => r.MMEAL_SC_NM === '중식') || rows[0];
  if (!lunch) return null;
  return {
    date: yyyymmdd,
    mealType: lunch.MMEAL_SC_NM || '급식',
    rawMenu: lunch.DDISH_NM || '',
    menu: stripHtmlMeal(lunch.DDISH_NM),
    calories: lunch.CAL_INFO || '',
    nutrition: lunch.NTR_INFO || '',
    origin: stripHtmlMeal(lunch.ORPLC_INFO || ''),
    allergies: extractAllergyNumbers(lunch.DDISH_NM)
  };
}

function allergyText(nums) {
  if (!nums || nums.length === 0) return '표시된 알레르기 정보 없음';
  return nums.map(n => `${n}.${ALLERGIES[n] || '기타'}`).join(', ');
}

function recommendDinner(menu) {
  const m = menu || '';
  if (/튀김|돈가스|치킨|너겟|탕수|꿔바|감자튀김/.test(m)) {
    return {
      reason: '점심에 튀김·기름진 메뉴가 있어요. 저녁은 담백하게 구성해보세요.',
      menus: ['두부샐러드', '계란찜과 나물', '닭가슴살 채소볶음'],
      shopping: ['두부', '양상추', '계란', '시금치', '닭가슴살', '파프리카']
    };
  }
  if (/고기|돼지|돈육|불고기|제육|갈비|햄|소시지/.test(m)) {
    return {
      reason: '점심에 육류 메뉴가 있어요. 저녁은 생선·두부·채소 위주가 좋아요.',
      menus: ['고등어구이', '두부조림', '버섯채소볶음'],
      shopping: ['고등어', '두부', '버섯', '양파', '애호박']
    };
  }
  if (/국수|라면|우동|떡볶이|스파게티|파스타|빵/.test(m)) {
    return {
      reason: '점심에 탄수화물 중심 메뉴가 있어요. 저녁은 단백질과 채소를 보충해보세요.',
      menus: ['닭가슴살 샐러드', '소고기채소국', '연두부와 계란말이'],
      shopping: ['닭가슴살', '샐러드채소', '소고기', '무', '연두부', '계란']
    };
  }
  return {
    reason: '점심 급식과 겹치지 않게 가볍고 균형 잡힌 저녁을 추천했어요.',
    menus: ['두부조림', '닭가슴살 채소볶음', '계란찜'],
    shopping: ['두부', '닭가슴살', '브로콜리', '계란', '대파']
  };
}

function formatMealReply(school, meal, userType) {
  if (!meal) {
    return `🍱 ${school.name}\n${formatKoreanDate(todayKST())} 급식 정보가 없습니다.\n\n급식이 없는 날이거나 아직 나이스에 등록되지 않았을 수 있어요.`;
  }
  const base = [
    `🍱 ${school.name} ${formatKoreanDate(meal.date)} ${meal.mealType}`,
    '',
    meal.menu || '메뉴 정보 없음',
    '',
    meal.calories ? `🔥 ${meal.calories}` : '',
    `⚠️ 알레르기: ${allergyText(meal.allergies)}`
  ].filter(Boolean).join('\n');

  if (userType === '학부모') {
    const rec = recommendDinner(meal.menu);
    return `${base}\n\n🍽️ 저녁 추천\n${rec.reason}\n\n1. ${rec.menus[0]}\n2. ${rec.menus[1]}\n3. ${rec.menus[2]}\n\n🛒 장보기 목록\n${rec.shopping.join(', ')}`;
  }
  return `${base}\n\n명령어: 내일 / 이번주 / 학교변경`;
}

async function formatWeekReply(school, userType) {
  const dates = getWeekDatesKST();
  const lines = [`📅 ${school.name} 이번 주 급식표`, ''];
  for (const date of dates) {
    const meal = await getMeal(school, date);
    const weekday = ['월', '화', '수', '목', '금'][dates.indexOf(date)];
    if (!meal) {
      lines.push(`${weekday} ${formatKoreanDate(date)}\n급식 정보 없음\n`);
    } else {
      const oneLineMenu = meal.menu.split('\n').filter(Boolean).slice(0, 6).join(' / ');
      lines.push(`${weekday} ${formatKoreanDate(date)}\n${oneLineMenu}\n`);
    }
  }
  if (userType === '학부모') lines.push('저녁 추천은 “오늘” 또는 “내일”을 입력하면 함께 확인할 수 있어요.');
  return lines.join('\n').trim();
}

async function handleMessage(userId, utterance) {
  const text = utterance.replace(/\s+/g, ' ').trim();
  const user = users.get(userId) || {};

  if (!text || /^(시작|메뉴|도움말|설정)$/i.test(text)) {
    return `🍱 급식톡 사용 방법\n\n1. 학교등록 백양고등학교\n2. 학생 또는 학부모 입력\n3. 오늘 / 내일 / 이번주 입력\n\n예시)\n학교등록 백양고등학교\n오늘`;
  }

  if (/^학교변경|^학교삭제|^초기화/.test(text)) {
    users.delete(userId);
    return '학교 정보를 초기화했어요.\n\n다시 등록하려면 아래처럼 입력해주세요.\n예: 학교등록 백양고등학교';
  }

  if (/^학교등록\s+/.test(text)) {
    const schoolName = text.replace(/^학교등록\s+/, '').trim();
    if (!schoolName) return '학교명을 함께 입력해주세요.\n예: 학교등록 백양고등학교';
    const schools = await searchSchool(schoolName);
    if (schools.length === 0) return `“${schoolName}” 학교를 찾지 못했어요.\n\n정식 학교명으로 다시 입력해주세요.\n예: 학교등록 백양고등학교`;
    const selected = schools[0];
    users.set(userId, { ...user, school: selected, pendingType: true });
    return `학교를 찾았어요.\n\n🏫 ${selected.name}\n${selected.officeName}\n${selected.address || ''}\n\n이 학교로 등록할게요.\n어떤 사용자로 이용하시나요?\n\n“학생” 또는 “학부모”라고 입력해주세요.`;
  }

  if (/^(학생|학부모)$/.test(text)) {
    if (!user.school) return '먼저 학교를 등록해주세요.\n예: 학교등록 백양고등학교';
    users.set(userId, { ...user, userType: text, pendingType: false });
    if (text === '학생') {
      return `${user.school.name} / 학생으로 등록했어요.\n\n이제 아래처럼 입력하면 됩니다.\n오늘\n내일\n이번주`;
    }
    return `${user.school.name} / 학부모로 등록했어요.\n\n이제 “오늘”이라고 입력하면 급식과 저녁 추천, 장보기 목록을 함께 보여드릴게요.`;
  }

  if (!user.school) {
    return '아직 학교가 등록되지 않았어요.\n\n아래처럼 먼저 입력해주세요.\n예: 학교등록 백양고등학교';
  }

  const userType = user.userType || '학생';

  if (/^(오늘|오늘급식|급식)$/.test(text)) {
    const meal = await getMeal(user.school, todayKST(0));
    return formatMealReply(user.school, meal, userType);
  }

  if (/^(내일|내일급식)$/.test(text)) {
    const meal = await getMeal(user.school, todayKST(1));
    return formatMealReply(user.school, meal, userType);
  }

  if (/^(이번주|이번 주|주간급식|이번주 급식)$/.test(text)) {
    return formatWeekReply(user.school, userType);
  }

  if (/^(저녁추천|장보기)$/.test(text)) {
    const meal = await getMeal(user.school, todayKST(0));
    if (!meal) return '오늘 급식 정보가 없어 저녁 추천을 만들 수 없어요.';
    const rec = recommendDinner(meal.menu);
    return `🍽️ 저녁 추천\n${rec.reason}\n\n1. ${rec.menus[0]}\n2. ${rec.menus[1]}\n3. ${rec.menus[2]}\n\n🛒 장보기 목록\n${rec.shopping.join(', ')}`;
  }

  return `입력한 내용을 이해하지 못했어요.\n\n사용 가능한 명령어:\n오늘 / 내일 / 이번주 / 학교변경 / 도움말`;
}

app.get('/', (req, res) => {
  res.type('text/plain').send('geupsiktalk kakao skill server is running. Use POST /skill');
});

app.get('/skill', (req, res) => {
  res.type('text/plain').send('POST /skill endpoint is ready for Kakao chatbot.');
});

app.get('/test', async (req, res) => {
  try {
    const schoolName = req.query.school || '백양고등학교';
    const schools = await searchSchool(schoolName);
    if (!schools.length) return res.json({ ok: false, message: 'school not found' });
    const meal = await getMeal(schools[0], req.query.date || todayKST(0));
    res.json({ ok: true, school: schools[0], meal });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/skill', async (req, res) => {
  try {
    const userId = getUserId(req.body);
    const utterance = getUtterance(req.body);
    const reply = await handleMessage(userId, utterance);
    res.json(kakaoText(reply));
  } catch (err) {
    console.error(err);
    res.json(kakaoText(`오류가 발생했어요.\n\n${err.message}\n\n잠시 후 다시 시도해주세요.`));
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`geupsiktalk server listening on port ${PORT}`);
});
