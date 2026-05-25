const express = require('express');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 10000;
const NEIS_API_KEY = process.env.NEIS_API_KEY || '';

// 테스트/초기 운영용 메모리 저장소입니다.
// Render 서버가 재시작되면 초기화됩니다. 실제 운영 단계에서는 DB로 교체하세요.
const userStore = new Map();

const ALLERGY_LABELS = {
  '1': '난류', '2': '우유', '3': '메밀', '4': '땅콩', '5': '대두', '6': '밀',
  '7': '고등어', '8': '게', '9': '새우', '10': '돼지고기', '11': '복숭아',
  '12': '토마토', '13': '아황산류', '14': '호두', '15': '닭고기', '16': '쇠고기',
  '17': '오징어', '18': '조개류', '19': '잣'
};

function todayYmd(offsetDays = 0) {
  const now = new Date();
  // 한국시간 기준 날짜 계산
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  kst.setUTCDate(kst.getUTCDate() + offsetDays);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function ymdToDisplay(ymd) {
  if (!ymd || ymd.length !== 8) return ymd || '';
  return `${ymd.slice(0, 4)}.${ymd.slice(4, 6)}.${ymd.slice(6, 8)}`;
}

function mondayOfThisWeekYmd() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay(); // 0 Sun, 1 Mon...
  const diff = day === 0 ? -6 : 1 - day;
  kst.setUTCDate(kst.getUTCDate() + diff);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function addDaysYmd(ymd, add) {
  const d = new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8))));
  d.setUTCDate(d.getUTCDate() + add);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${dd}`;
}

function getUserId(body) {
  return body?.userRequest?.user?.id || body?.userRequest?.user?.properties?.botUserKey || 'anonymous';
}

function getUtterance(body) {
  return (body?.userRequest?.utterance || '').trim();
}

function normalizeText(text) {
  return (text || '').replace(/\s+/g, '').toLowerCase();
}

function simpleResponse(text, quickReplies = []) {
  return {
    version: '2.0',
    template: {
      outputs: [{ simpleText: { text } }],
      quickReplies
    }
  };
}

function quick(label, messageText = label) {
  return { label, action: 'message', messageText };
}

function mainQuickReplies(userType) {
  const base = [
    quick('오늘 급식', '오늘'),
    quick('내일 급식', '내일'),
    quick('이번 주 급식', '이번주'),
    quick('학교 변경', '학교변경')
  ];
  if (userType === 'parent') {
    base.splice(3, 0, quick('저녁추천', '저녁추천'), quick('장보기', '장보기'));
  }
  return base;
}

function startQuickReplies() {
  return [
    quick('학교등록', '학교등록'),
    quick('학교변경', '학교변경'),
    quick('오늘 급식', '오늘'),
    quick('이번 주 급식', '이번주'),
    quick('도움말', '도움말')
  ];
}

function roleQuickReplies() {
  return [quick('학생', '학생'), quick('학부모', '학부모'), quick('학교 다시 등록', '학교변경')];
}

function needSchoolResponse() {
  return simpleResponse(
    '🍱 먼저 학교를 등록해주세요.\n\n예시처럼 입력하면 됩니다.\n학교등록 백양고등학교\n\n아래 버튼을 눌러 시작할 수도 있어요.',
    [quick('학교등록', '학교등록'), quick('도움말', '도움말')]
  );
}

function helpResponse(user) {
  const schoolLine = user?.school ? `\n현재 등록 학교: ${user.school.name}` : '\n현재 등록된 학교가 없습니다.';
  const roleLine = user?.role ? `\n사용자 유형: ${user.role === 'parent' ? '학부모' : '학생'}` : '\n사용자 유형이 아직 선택되지 않았습니다.';
  return simpleResponse(
    `🍱 급식톡 사용 방법${schoolLine}${roleLine}\n\n1. 학교 등록\n학교등록 백양고등학교\n\n2. 사용자 유형 선택\n학생 또는 학부모\n\n3. 급식 확인\n오늘 / 내일 / 이번주\n\n4. 학교를 바꿀 때\n학교변경\n\n학생은 급식을 빠르게 확인하고, 학부모는 저녁추천과 장보기 목록까지 이용할 수 있어요.`,
    startQuickReplies()
  );
}

function parseSchoolName(utterance) {
  const trimmed = utterance.trim();
  let name = trimmed
    .replace(/^학교\s*등록/i, '')
    .replace(/^학교등록/i, '')
    .replace(/^내\s*학교\s*등록/i, '')
    .replace(/^학교\s*변경/i, '')
    .replace(/^학교변경/i, '')
    .trim();
  return name;
}

async function fetchJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON from API: ${text.slice(0, 200)}`);
  }
}

async function searchSchool(schoolName) {
  if (!NEIS_API_KEY) throw new Error('NEIS_API_KEY is missing');
  const url = new URL('https://open.neis.go.kr/hub/schoolInfo');
  url.searchParams.set('KEY', NEIS_API_KEY);
  url.searchParams.set('Type', 'json');
  url.searchParams.set('pIndex', '1');
  url.searchParams.set('pSize', '5');
  url.searchParams.set('SCHUL_NM', schoolName);
  const data = await fetchJson(url);
  const rows = data?.schoolInfo?.[1]?.row || [];
  if (!rows.length) return null;
  const exact = rows.find(r => r.SCHUL_NM === schoolName) || rows[0];
  return {
    name: exact.SCHUL_NM,
    officeCode: exact.ATPT_OFCDC_SC_CODE,
    schoolCode: exact.SD_SCHUL_CODE,
    officeName: exact.ATPT_OFCDC_SC_NM,
    address: exact.ORG_RDNMA || ''
  };
}

function cleanDishName(raw) {
  return (raw || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .split('\n')
    .map(s => s.replace(/\s*\([\d\.]+\)/g, '').trim())
    .filter(Boolean);
}

function extractAllergyNumbers(raw) {
  const found = new Set();
  const matches = (raw || '').match(/\(([^)]*)\)/g) || [];
  for (const m of matches) {
    const nums = m.match(/\d+/g) || [];
    nums.forEach(n => {
      if (ALLERGY_LABELS[n]) found.add(n);
    });
  }
  return Array.from(found).sort((a, b) => Number(a) - Number(b));
}

async function getMeal(school, ymd) {
  if (!NEIS_API_KEY) throw new Error('NEIS_API_KEY is missing');
  const url = new URL('https://open.neis.go.kr/hub/mealServiceDietInfo');
  url.searchParams.set('KEY', NEIS_API_KEY);
  url.searchParams.set('Type', 'json');
  url.searchParams.set('pIndex', '1');
  url.searchParams.set('pSize', '10');
  url.searchParams.set('ATPT_OFCDC_SC_CODE', school.officeCode);
  url.searchParams.set('SD_SCHUL_CODE', school.schoolCode);
  url.searchParams.set('MLSV_YMD', ymd);
  const data = await fetchJson(url);
  const rows = data?.mealServiceDietInfo?.[1]?.row || [];
  if (!rows.length) return null;
  const lunch = rows.find(r => r.MMEAL_SC_NM === '중식') || rows[0];
  const rawDishes = lunch.DDISH_NM || '';
  return {
    date: lunch.MLSV_YMD || ymd,
    mealType: lunch.MMEAL_SC_NM || '급식',
    dishes: cleanDishName(rawDishes),
    calories: lunch.CAL_INFO || '',
    nutrition: lunch.NTR_INFO || '',
    origin: lunch.ORPLC_INFO || '',
    allergyNumbers: extractAllergyNumbers(rawDishes),
    raw: lunch
  };
}

async function getWeeklyMeals(school) {
  const monday = mondayOfThisWeekYmd();
  const days = ['월', '화', '수', '목', '금'];
  const result = [];
  for (let i = 0; i < 5; i++) {
    const ymd = addDaysYmd(monday, i);
    const meal = await getMeal(school, ymd).catch(() => null);
    result.push({ day: days[i], ymd, meal });
  }
  return result;
}

function mealText(school, meal, label = '오늘 급식', compact = false) {
  if (!meal) {
    return `🍱 ${school.name} ${label}\n\n해당 날짜에 등록된 급식 정보가 없어요.\n휴일, 방학, 재량휴업일이거나 아직 급식 정보가 등록되지 않았을 수 있어요.`;
  }
  const allergyLabels = meal.allergyNumbers.map(n => ALLERGY_LABELS[n]).filter(Boolean);
  const dishes = meal.dishes.length ? meal.dishes.join('\n') : '메뉴 정보 없음';
  let text = `🍱 ${school.name} ${label}\n${ymdToDisplay(meal.date)} ${meal.mealType}\n\n${dishes}`;
  if (meal.calories && !compact) text += `\n\n🔥 ${meal.calories}`;
  if (allergyLabels.length && !compact) text += `\n⚠️ 알레르기: ${allergyLabels.join(', ')}`;
  return text;
}

function weeklyText(school, items) {
  let text = `📅 ${school.name} 이번 주 급식표\n`;
  for (const item of items) {
    const dateLabel = `${item.day} ${ymdToDisplay(item.ymd).slice(5)}`;
    if (!item.meal) {
      text += `\n${dateLabel}\n- 급식 정보 없음\n`;
    } else {
      text += `\n${dateLabel}\n- ${item.meal.dishes.slice(0, 6).join(' / ')}\n`;
    }
  }
  return text.trim();
}

function recommendDinner(meal) {
  const joined = (meal?.dishes || []).join(' ');
  const heavy = /튀김|돈가스|치킨|탕수|꿔바로우|마라|제육|불고기|갈비|햄버거|피자|라면|떡볶/.test(joined);
  const soup = /국|탕|찌개|전골|마라탕/.test(joined);
  const noodle = /면|국수|스파게티|우동|짜장|짬뽕/.test(joined);

  if (heavy || soup) {
    return {
      reason: '점심에 고기·국물·기름진 메뉴가 있어 저녁은 가볍게 구성해보세요.',
      menus: [
        { name: '두부샐러드', ingredients: ['두부', '양상추', '오이', '방울토마토', '참깨드레싱'] },
        { name: '닭가슴살 채소볶음', ingredients: ['닭가슴살', '양파', '파프리카', '브로콜리'] },
        { name: '계란찜과 나물반찬', ingredients: ['계란', '시금치', '콩나물', '당근'] }
      ]
    };
  }
  if (noodle) {
    return {
      reason: '점심에 면류가 있어 저녁은 밥과 단백질, 채소를 함께 구성해보세요.',
      menus: [
        { name: '소고기야채덮밥', ingredients: ['소고기', '양파', '당근', '애호박', '쌀'] },
        { name: '두부된장국과 잡곡밥', ingredients: ['두부', '된장', '애호박', '양파', '잡곡'] },
        { name: '연어구이와 샐러드', ingredients: ['연어', '양상추', '오이', '레몬'] }
      ]
    };
  }
  return {
    reason: '점심 급식과 겹치지 않게 단백질과 채소를 보충하는 저녁을 추천해요.',
    menus: [
      { name: '닭가슴살 채소볶음', ingredients: ['닭가슴살', '양파', '파프리카', '브로콜리'] },
      { name: '두부김치', ingredients: ['두부', '김치', '대파', '참기름'] },
      { name: '계란볶음밥', ingredients: ['계란', '밥', '대파', '당근', '양파'] }
    ]
  };
}

function dinnerText(meal) {
  if (!meal) {
    return '🍽️ 저녁추천\n\n오늘 급식 정보가 없어 기본 저녁 메뉴를 추천해요.\n\n1. 두부샐러드\n2. 닭가슴살 채소볶음\n3. 계란찜과 나물반찬';
  }
  const rec = recommendDinner(meal);
  const menuLines = rec.menus.map((m, idx) => `${idx + 1}. ${m.name}`).join('\n');
  return `🍽️ 오늘 저녁 추천\n\n${rec.reason}\n\n${menuLines}\n\n레시피는 메뉴명을 네이버나 유튜브에서 검색해보세요.`;
}

function shoppingText(meal) {
  const rec = recommendDinner(meal);
  const items = Array.from(new Set(rec.menus.flatMap(m => m.ingredients)));
  return `🛒 장보기 목록\n\n${items.map(i => `□ ${i}`).join('\n')}\n\n추천 메뉴\n${rec.menus.map(m => `- ${m.name}`).join('\n')}`;
}

function registerSchoolResponse(school) {
  return simpleResponse(
    `🍱 ${school.name}을 찾았어요.\n${school.address ? school.address + '\n' : ''}\n\n어떤 사용자로 이용하시나요?\n아래 버튼을 선택해주세요.`,
    roleQuickReplies()
  );
}

function roleSavedResponse(user) {
  const roleLabel = user.role === 'parent' ? '학부모' : '학생';
  const extra = user.role === 'parent'
    ? '\n학부모 기능으로 저녁추천과 장보기 목록도 이용할 수 있어요.'
    : '\n학생 기능으로 오늘/내일/이번 주 급식을 빠르게 확인할 수 있어요.';
  return simpleResponse(
    `✅ ${user.school.name} / ${roleLabel}으로 등록했어요.${extra}\n\n이제 아래 버튼으로 급식을 확인해보세요.`,
    mainQuickReplies(user.role)
  );
}

function resetResponse() {
  return simpleResponse(
    '학교 정보를 초기화했어요.\n새 학교를 등록하려면 아래처럼 입력해주세요.\n\n학교등록 백양고등학교',
    [quick('학교등록', '학교등록'), quick('도움말', '도움말')]
  );
}

function unknownResponse(user) {
  return simpleResponse(
    '무엇을 원하는지 잘 모르겠어요.\n아래 버튼을 눌러 이용해보세요.',
    user?.school ? mainQuickReplies(user.role) : startQuickReplies()
  );
}

async function handleSkill(body) {
  const utterance = getUtterance(body);
  const norm = normalizeText(utterance);
  const userId = getUserId(body);
  const user = userStore.get(userId) || {};

  if (!utterance || ['시작', '처음', '메뉴', '도움말', '설정', '처음으로'].includes(norm)) {
    return helpResponse(user);
  }

  if (norm.includes('학교변경') || norm.includes('학교바꾸기') || norm === '초기화') {
    userStore.delete(userId);
    return resetResponse();
  }

  if (norm.startsWith('학교등록') || norm.startsWith('학교등록하기') || norm === '학교등록') {
    const schoolName = parseSchoolName(utterance);
    if (!schoolName) {
      return simpleResponse(
        '등록할 학교명을 함께 입력해주세요.\n\n예시) 학교등록 백양고등학교',
        [quick('학교등록 백양고등학교'), quick('학교변경')]
      );
    }
    const school = await searchSchool(schoolName);
    if (!school) {
      return simpleResponse(
        `“${schoolName}” 학교를 찾지 못했어요.\n학교명을 조금 더 정확히 입력해주세요.\n\n예시) 학교등록 백양고등학교`,
        [quick('학교등록', '학교등록'), quick('도움말', '도움말')]
      );
    }
    userStore.set(userId, { ...user, school, role: null, pendingRole: true });
    return registerSchoolResponse(school);
  }

  if (['학생', '나는학생', '학생입니다'].includes(norm) || ['학부모', '부모', '보호자', '나는학부모', '학부모입니다'].includes(norm)) {
    if (!user.school) return needSchoolResponse();
    const role = ['학부모', '부모', '보호자', '나는학부모', '학부모입니다'].includes(norm) ? 'parent' : 'student';
    const next = { ...user, role, pendingRole: false };
    userStore.set(userId, next);
    return roleSavedResponse(next);
  }

  if (!user.school && (norm.includes('오늘') || norm.includes('내일') || norm.includes('이번주') || norm.includes('주간') || norm.includes('저녁') || norm.includes('장보기') || norm === '급식')) {
    return needSchoolResponse();
  }

  if (norm.includes('오늘') || norm === '급식' || norm.includes('오늘급식')) {
    const meal = await getMeal(user.school, todayYmd(0));
    let text = mealText(user.school, meal, '오늘 급식');
    if (user.role === 'parent') text += `\n\n${dinnerText(meal)}\n\n${shoppingText(meal)}`;
    return simpleResponse(text, mainQuickReplies(user.role));
  }

  if (norm.includes('내일') || norm.includes('내일급식')) {
    const meal = await getMeal(user.school, todayYmd(1));
    let text = mealText(user.school, meal, '내일 급식');
    if (user.role === 'parent') text += '\n\n내일 저녁 준비도 급식 구성을 보고 가볍게 조절해보세요.';
    return simpleResponse(text, mainQuickReplies(user.role));
  }

  if (norm.includes('이번주') || norm.includes('이번주급식') || norm.includes('주간')) {
    const items = await getWeeklyMeals(user.school);
    return simpleResponse(weeklyText(user.school, items), mainQuickReplies(user.role));
  }

  if (norm.includes('저녁')) {
    if (!user.school) return needSchoolResponse();
    const meal = await getMeal(user.school, todayYmd(0));
    return simpleResponse(dinnerText(meal), mainQuickReplies(user.role || 'parent'));
  }

  if (norm.includes('장보기') || norm.includes('장바구니')) {
    if (!user.school) return needSchoolResponse();
    const meal = await getMeal(user.school, todayYmd(0));
    return simpleResponse(shoppingText(meal), mainQuickReplies(user.role || 'parent'));
  }

  return unknownResponse(user);
}

app.get('/', (req, res) => {
  res.type('text/plain').send('geupsiktalk kakao skill server final is running. Use POST /skill');
});

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'geupsiktalk-skill-server', time: new Date().toISOString() });
});

app.get('/test', async (req, res) => {
  try {
    const schoolName = req.query.school || '백양고등학교';
    const date = req.query.date || todayYmd(0);
    const school = await searchSchool(schoolName);
    const meal = school ? await getMeal(school, date) : null;
    res.json({ ok: true, school, meal });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/skill', async (req, res) => {
  try {
    const response = await handleSkill(req.body || {});
    res.json(response);
  } catch (err) {
    console.error(err);
    res.json(simpleResponse(
      `일시적인 오류가 발생했어요.\n잠시 후 다시 시도해주세요.\n\n오류: ${err.message}`,
      [quick('도움말', '도움말'), quick('학교변경', '학교변경')]
    ));
  }
});

app.listen(PORT, () => {
  console.log(`geupsiktalk skill server final listening on port ${PORT}`);
});
