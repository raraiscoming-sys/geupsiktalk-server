const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.PORT || 3000;
const NEIS_API_KEY = process.env.NEIS_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!NEIS_API_KEY) console.warn('WARN: NEIS_API_KEY is missing');
if (!SUPABASE_URL) console.warn('WARN: SUPABASE_URL is missing');
if (!SUPABASE_SERVICE_ROLE_KEY) console.warn('WARN: SUPABASE_SERVICE_ROLE_KEY is missing');

let supabase = null;
try {
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && /^https?:\/\//i.test(SUPABASE_URL.trim())) {
    supabase = createClient(SUPABASE_URL.trim(), SUPABASE_SERVICE_ROLE_KEY.trim(), { auth: { persistSession: false } });
  } else {
    console.warn('WARN: Supabase is disabled. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.');
  }
} catch (error) {
  console.error('WARN: Failed to initialize Supabase. Server will continue without DB persistence:', error.message);
  supabase = null;
}

const ALLERGY_MAP = {
  '1': '난류', '2': '우유', '3': '메밀', '4': '땅콩', '5': '대두', '6': '밀',
  '7': '고등어', '8': '게', '9': '새우', '10': '돼지고기', '11': '복숭아',
  '12': '토마토', '13': '아황산류', '14': '호두', '15': '닭고기', '16': '쇠고기',
  '17': '오징어', '18': '조개류', '19': '잣'
};

const MEAL_ORDER = { '조식': 1, '중식': 2, '석식': 3 };

function textResponse(text, quickReplies = []) {
  return {
    version: '2.0',
    template: {
      outputs: [{ simpleText: { text: trimKakaoText(text) } }],
      quickReplies: quickReplies.slice(0, 10).map(q => ({
        label: q.label,
        action: 'message',
        messageText: q.messageText || q.label
      }))
    }
  };
}

function trimKakaoText(text) {
  if (!text) return '';
  // Kakao simpleText has practical length limits. Keep responses readable.
  return String(text).slice(0, 990);
}

function getUserId(body) {
  return body?.userRequest?.user?.id || body?.userRequest?.user?.properties?.botUserKey || 'anonymous';
}

function getUtterance(body) {
  return (body?.userRequest?.utterance || '').trim();
}

async function getUser(kakaoUserId) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('kakao_users')
    .select('*')
    .eq('kakao_user_id', kakaoUserId)
    .maybeSingle();
  if (error) {
    console.error('getUser error:', error.message);
    return null;
  }
  return data;
}

async function saveUser(kakaoUserId, patch) {
  if (!supabase) return null;
  const payload = {
    kakao_user_id: kakaoUserId,
    ...patch,
    updated_at: new Date().toISOString()
  };
  const { data, error } = await supabase
    .from('kakao_users')
    .upsert(payload, { onConflict: 'kakao_user_id' })
    .select()
    .maybeSingle();
  if (error) {
    console.error('saveUser error:', error.message);
    return null;
  }
  return data;
}

async function clearUser(kakaoUserId) {
  if (!supabase) return null;
  return saveUser(kakaoUserId, {
    user_type: null,
    school_name: null,
    office_code: null,
    school_code: null,
    office_name: null,
    school_address: null,
    pending_schools: null,
    pending_action: 'awaiting_school_name'
  });
}

function mainMenuButtons() {
  return [
    { label: '학교등록', messageText: '학교등록' },
    { label: '오늘 급식', messageText: '오늘' },
    { label: '내일 급식', messageText: '내일' },
    { label: '이번 주 급식', messageText: '이번주' },
    { label: '도움말', messageText: '도움말' }
  ];
}

function registeredButtons() {
  return [
    { label: '오늘 급식', messageText: '오늘' },
    { label: '내일 급식', messageText: '내일' },
    { label: '이번 주 급식', messageText: '이번주' },
    { label: '학교 변경', messageText: '학교변경' }
  ];
}

function userTypeButtons() {
  return [
    { label: '학생', messageText: '학생' },
    { label: '학부모', messageText: '학부모' },
    { label: '학교 다시 검색', messageText: '학교등록' }
  ];
}

function searchAgainButtons() {
  return [
    { label: '학교 다시 검색', messageText: '학교등록' },
    { label: '도움말', messageText: '도움말' }
  ];
}

function helpText() {
  return `🍱 급식톡 사용 방법\n\n1. [학교등록]을 누르거나 “학교등록”이라고 입력하세요.\n2. 안내가 나오면 학교명을 입력하세요.\n3. 같은 이름의 학교가 여러 개면 지역과 주소를 보고 번호를 선택하세요.\n4. 학생/학부모를 선택하면 등록이 끝납니다.\n\n학교명은 약칭보다 정식 학교명이 정확해요.\n예) 남천중 → 남천중학교\n예) 00여중 → 00여자중학교\n예) 백양고 → 백양고등학교`; 
}

function normalizeQuery(raw) {
  return raw
    .replace(/^학교등록\s*/g, '')
    .replace(/^학교\s*등록\s*/g, '')
    .replace(/^학교검색\s*/g, '')
    .replace(/^학교\s*검색\s*/g, '')
    .trim();
}

function isHelp(text) {
  return ['처음', '시작', '설정', '도움말', '메뉴', '사용법'].includes(text);
}
function isRegisterStart(text) {
  return ['학교등록', '학교 등록', '학교검색', '학교 검색'].includes(text);
}
function isChangeSchool(text) {
  return ['학교변경', '학교 변경', '학교 바꾸기', '학교바꾸기', '다시 검색'].includes(text);
}
function isUserType(text) {
  return ['학생', '나는 학생', '학생입니다', '학부모', '부모', '보호자', '나는 학부모', '학부모입니다'].includes(text);
}
function normalizeUserType(text) {
  if (text.includes('학부모') || text.includes('부모') || text.includes('보호자')) return '학부모';
  return '학생';
}
function parseSelection(text) {
  const m = text.match(/^(\d+)(?:번)?(?:\s*선택)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function yyyymmdd(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}
function dateDisplay(dateStr) {
  return `${dateStr.slice(0,4)}.${dateStr.slice(4,6)}.${dateStr.slice(6,8)}`;
}
function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}
function weekDates(base = new Date()) {
  const day = base.getDay(); // 0 Sun, 1 Mon
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = addDays(base, diffToMonday);
  return [0,1,2,3,4].map(i => addDays(monday, i));
}

async function neisFetch(endpoint, params) {
  const url = new URL(`https://open.neis.go.kr/hub/${endpoint}`);
  url.searchParams.set('KEY', NEIS_API_KEY || '');
  url.searchParams.set('Type', 'json');
  url.searchParams.set('pIndex', '1');
  url.searchParams.set('pSize', params.pSize || '100');
  Object.entries(params).forEach(([k,v]) => {
    if (v !== undefined && v !== null && k !== 'pSize') url.searchParams.set(k, v);
  });
  const res = await fetch(url.toString());
  const json = await res.json();
  return json;
}

async function searchSchools(query) {
  const q = query.trim();
  if (!q) return [];
  const json = await neisFetch('schoolInfo', { SCHUL_NM: q, pSize: '20' });
  const rows = json?.schoolInfo?.[1]?.row || [];
  return rows.map(r => ({
    name: r.SCHUL_NM,
    officeCode: r.ATPT_OFCDC_SC_CODE,
    schoolCode: r.SD_SCHUL_CODE,
    officeName: r.ATPT_OFCDC_SC_NM,
    address: r.ORG_RDNMA || r.ORG_RDNDA || ''
  }));
}

async function fetchMeals(school, dateStr) {
  const json = await neisFetch('mealServiceDietInfo', {
    ATPT_OFCDC_SC_CODE: school.officeCode || school.office_code,
    SD_SCHUL_CODE: school.schoolCode || school.school_code,
    MLSV_YMD: dateStr,
    pSize: '20'
  });
  const rows = json?.mealServiceDietInfo?.[1]?.row || [];
  return rows.map(r => ({
    mealType: r.MMEAL_SC_NM || '급식',
    dishesRaw: r.DDISH_NM || '',
    dishes: parseDishes(r.DDISH_NM || ''),
    calorie: r.CAL_INFO || '',
    nutrition: r.NTR_INFO || ''
  })).sort((a,b) => (MEAL_ORDER[a.mealType] || 99) - (MEAL_ORDER[b.mealType] || 99));
}

function parseDishes(raw) {
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .split('\n')
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function extractAllergyNumbersFromDishes(dishes) {
  const set = new Set();
  for (const dish of dishes) {
    const parens = [...dish.matchAll(/\(([^)]*)\)/g)];
    for (const p of parens) {
      const nums = String(p[1]).match(/\d+/g) || [];
      nums.forEach(n => { if (ALLERGY_MAP[n]) set.add(n); });
    }
  }
  return [...set].sort((a,b) => Number(a) - Number(b));
}

function allergySummary(nums) {
  if (!nums || nums.length === 0) return '표시된 알레르기 번호 없음';
  return nums.map(n => `${n}.${ALLERGY_MAP[n]}`).join(' · ');
}

function allergyLegendShort() {
  return '알레르기 번호: 1난류 2우유 3메밀 4땅콩 5대두 6밀 7고등어 8게 9새우 10돼지고기 11복숭아 12토마토 13아황산류 14호두 15닭고기 16쇠고기 17오징어 18조개류 19잣';
}

function formatMealDay(schoolName, dateStr, meals) {
  if (!meals || meals.length === 0) {
    return `🍱 ${schoolName} 급식\n${dateDisplay(dateStr)}\n\n해당 날짜의 급식 정보가 없어요.`;
  }
  let text = `🍱 ${schoolName} 급식\n${dateDisplay(dateStr)}\n`;
  for (const meal of meals) {
    const nums = extractAllergyNumbersFromDishes(meal.dishes);
    text += `\n🍽️ ${meal.mealType}\n`;
    text += meal.dishes.map(d => `· ${d}`).join('\n');
    if (meal.calorie) text += `\n🔥 ${meal.calorie}`;
    text += `\n⚠️ ${allergySummary(nums)}\n`;
  }
  text += `\n${allergyLegendShort()}`;
  return text;
}

function findLunchOrFirst(meals) {
  if (!meals || meals.length === 0) return null;
  return meals.find(m => m.mealType === '중식') || meals[0];
}

function parentDinnerSuggestion(meals) {
  const base = findLunchOrFirst(meals);
  if (!base) return '';
  const dishesText = base.dishes.join(' ');
  let menus;
  if (/튀김|돈가스|치킨|탕수|너겟|가라아게|핫도그/.test(dishesText)) {
    menus = [
      { name: '두부샐러드', items: ['두부', '양상추', '오이', '토마토'] },
      { name: '계란찜', items: ['계란', '대파'] },
      { name: '나물비빔밥', items: ['시금치', '콩나물', '당근'] }
    ];
  } else if (/돼지|돈육|소고기|닭|갈비|불고기|제육/.test(dishesText)) {
    menus = [
      { name: '생선구이', items: ['생선', '레몬', '상추'] },
      { name: '두부조림', items: ['두부', '양파', '대파'] },
      { name: '채소계란말이', items: ['계란', '당근', '양파'] }
    ];
  } else if (/면|국수|라면|우동|스파게티|파스타/.test(dishesText)) {
    menus = [
      { name: '현미밥과 된장국', items: ['현미', '된장', '두부', '애호박'] },
      { name: '닭가슴살 채소볶음', items: ['닭가슴살', '브로콜리', '양파'] },
      { name: '오이무침', items: ['오이', '고춧가루', '식초'] }
    ];
  } else {
    menus = [
      { name: '닭가슴살 채소볶음', items: ['닭가슴살', '브로콜리', '양파'] },
      { name: '두부된장국', items: ['두부', '된장', '애호박', '대파'] },
      { name: '계란찜', items: ['계란', '대파'] }
    ];
  }
  const shopping = [...new Set(menus.flatMap(m => m.items))];
  return `\n\n🍽️ 학부모 저녁 추천\n점심 급식 기준으로 저녁은 이렇게 가볍게 구성해보세요.\n` +
    menus.map((m,i) => `${i+1}. ${m.name}`).join('\n') +
    `\n\n🛒 장보기 목록\n${shopping.join(', ')}`;
}

async function handleSchoolSearch(kakaoUserId, query) {
  const clean = normalizeQuery(query);
  if (!clean) {
    await saveUser(kakaoUserId, { pending_action: 'awaiting_school_name', pending_schools: null });
    return textResponse(
      `등록할 학교명을 입력해주세요.\n\n검색이 안 되면 약칭보다 정식 학교명으로 입력해주세요.\n예) 남천중 → 남천중학교\n예) 00여중 → 00여자중학교\n예) 백양고 → 백양고등학교`,
      [{ label: '도움말', messageText: '도움말' }]
    );
  }

  const schools = await searchSchools(clean);
  if (schools.length === 0) {
    await saveUser(kakaoUserId, { pending_action: 'awaiting_school_name', pending_schools: null });
    return textResponse(
      `'${clean}' 검색 결과가 없어요.\n\n학교명을 다시 입력해주세요.\n학교 약칭보다는 나이스에 등록된 정식 학교명으로 검색하면 더 정확해요.\n예) 00여중 → 00여자중학교\n예) 남천중 → 남천중학교\n예) 백양고 → 백양고등학교`,
      searchAgainButtons()
    );
  }

  const top = schools.slice(0, 5);
  await saveUser(kakaoUserId, { pending_action: 'selecting_school', pending_schools: top });

  const lines = top.map((s,i) => `${i+1}. ${s.name} / ${s.officeName}\n   ${s.address || '주소 정보 없음'}`).join('\n\n');
  const buttons = top.map((s,i) => ({ label: `${i+1}번 선택`, messageText: `${i+1}번` }));
  buttons.push({ label: '다시 검색', messageText: '학교등록' });
  return textResponse(
    `'${clean}' 검색 결과예요.\n이름이 같은 학교가 있을 수 있으니 지역과 주소를 확인한 뒤 번호를 선택해주세요.\n\n${lines}`,
    buttons
  );
}

async function handleSchoolSelection(kakaoUserId, user, n) {
  const list = Array.isArray(user?.pending_schools) ? user.pending_schools : [];
  if (!n || n < 1 || n > list.length) {
    return textResponse('선택 번호를 찾을 수 없어요. 검색 결과의 번호를 눌러주세요.', searchAgainButtons());
  }
  const selected = list[n - 1];
  await saveUser(kakaoUserId, {
    school_name: selected.name,
    office_code: selected.officeCode,
    school_code: selected.schoolCode,
    office_name: selected.officeName,
    school_address: selected.address,
    pending_schools: null,
    pending_action: 'awaiting_user_type',
    user_type: null
  });
  return textResponse(
    `${selected.name}을 선택했어요.\n\n어떤 사용자로 이용하시나요?`,
    userTypeButtons()
  );
}

async function handleUserType(kakaoUserId, user, text) {
  if (!user?.school_code) {
    return textResponse('먼저 학교를 등록해주세요.', [{ label: '학교등록', messageText: '학교등록' }]);
  }
  const type = normalizeUserType(text);
  await saveUser(kakaoUserId, { user_type: type, pending_action: null });
  return textResponse(
    `${user.school_name} / ${type}으로 등록했어요.\n\n이제 오늘, 내일, 이번주 급식을 확인할 수 있어요.`,
    registeredButtons()
  );
}

async function handleMealLookup(user, when) {
  if (!user?.school_code || !user?.office_code) {
    return textResponse('먼저 학교를 등록해주세요.', [{ label: '학교등록', messageText: '학교등록' }]);
  }
  const today = new Date();
  let date = today;
  if (when === 'tomorrow') date = addDays(today, 1);
  const dateStr = yyyymmdd(date);
  const school = { office_code: user.office_code, school_code: user.school_code };
  const meals = await fetchMeals(school, dateStr);
  let text = formatMealDay(user.school_name, dateStr, meals);
  if (user.user_type === '학부모' && meals.length > 0) {
    text += parentDinnerSuggestion(meals);
  }
  return textResponse(text, registeredButtons());
}

async function handleWeek(user) {
  if (!user?.school_code || !user?.office_code) {
    return textResponse('먼저 학교를 등록해주세요.', [{ label: '학교등록', messageText: '학교등록' }]);
  }
  const school = { office_code: user.office_code, school_code: user.school_code };
  const labels = ['월', '화', '수', '목', '금'];
  let text = `📅 ${user.school_name} 이번 주 급식표\n`;
  const dates = weekDates(new Date());
  for (let i = 0; i < dates.length; i++) {
    const ds = yyyymmdd(dates[i]);
    const meals = await fetchMeals(school, ds);
    text += `\n${labels[i]} ${dateDisplay(ds)}\n`;
    if (meals.length === 0) {
      text += '급식 정보 없음\n';
    } else {
      for (const meal of meals) {
        const dishPreview = meal.dishes.map(d => d.replace(/\([^)]*\)/g, '').trim()).slice(0, 5).join(' / ');
        const nums = extractAllergyNumbersFromDishes(meal.dishes);
        text += `· ${meal.mealType}: ${dishPreview}\n`;
        if (nums.length) text += `  ⚠️ ${allergySummary(nums)}\n`;
      }
    }
  }
  return textResponse(text, registeredButtons());
}

async function handleSkill(body) {
  const kakaoUserId = getUserId(body);
  const utterance = getUtterance(body);
  const text = utterance.trim();
  let user = await getUser(kakaoUserId);

  if (isHelp(text)) return textResponse(helpText(), mainMenuButtons());

  if (isChangeSchool(text)) {
    await clearUser(kakaoUserId);
    return textResponse('학교 정보를 초기화했어요.\n등록할 학교명을 입력해주세요.\n\n예) 남천중학교, 백양고등학교, 서울고등학교', [{ label: '도움말', messageText: '도움말' }]);
  }

  if (isRegisterStart(text)) {
    return handleSchoolSearch(kakaoUserId, '');
  }

  if (/^학교\s*등록\s+/.test(text) || /^학교등록\s+/.test(text) || /^학교\s*검색\s+/.test(text) || /^학교검색\s+/.test(text)) {
    return handleSchoolSearch(kakaoUserId, text);
  }

  const selection = parseSelection(text);
  if (selection && user?.pending_action === 'selecting_school') {
    return handleSchoolSelection(kakaoUserId, user, selection);
  }

  if (isUserType(text)) {
    return handleUserType(kakaoUserId, user, text);
  }

  if (['오늘', '오늘급식', '오늘 급식', '급식', '오늘 뭐 나와'].includes(text)) {
    return handleMealLookup(user, 'today');
  }
  if (['내일', '내일급식', '내일 급식', '내일 뭐 나와'].includes(text)) {
    return handleMealLookup(user, 'tomorrow');
  }
  if (['이번주', '이번 주', '이번주 급식', '이번 주 급식', '주간급식'].includes(text)) {
    return handleWeek(user);
  }

  // If user is in school-name input state, treat any non-command text as school search.
  if (user?.pending_action === 'awaiting_school_name' || !user?.school_code) {
    return handleSchoolSearch(kakaoUserId, text);
  }

  return textResponse('무엇을 원하는지 잘 모르겠어요. 아래 버튼을 눌러 이용해보세요.', mainMenuButtons());
}

app.get('/', (req, res) => {
  res.type('text/plain').send('geupsiktalk kakao skill server with Supabase is running. Use POST /skill');
});

app.get('/health', async (req, res) => {
  res.json({ ok: true, supabase: !!supabase, neisKey: !!NEIS_API_KEY, time: new Date().toISOString() });
});

app.get('/test', async (req, res) => {
  try {
    const schoolName = req.query.school || '백양고등학교';
    const date = req.query.date || yyyymmdd(new Date());
    const schools = await searchSchools(schoolName);
    const school = schools[0];
    const meals = school ? await fetchMeals(school, date) : [];
    res.json({ ok: true, query: schoolName, school, date, meals });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/skill', async (req, res) => {
  try {
    const response = await handleSkill(req.body || {});
    res.json(response);
  } catch (err) {
    console.error('skill error:', err);
    res.json(textResponse('처리 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.', mainMenuButtons()));
  }
});

app.listen(PORT, () => {
  console.log(`geupsiktalk server listening on port ${PORT}`);
});
