const express = require('express');
const app = express();
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.PORT || 10000;
const NEIS_API_KEY = process.env.NEIS_API_KEY || '';

// Simple in-memory store. For real service, replace with DB.
const sessions = new Map();

const SCHOOL_API = 'https://open.neis.go.kr/hub/schoolInfo';
const MEAL_API = 'https://open.neis.go.kr/hub/mealServiceDietInfo';

const FALLBACK_BUTTONS = [
  qr('학교등록', '학교등록'),
  qr('학교변경', '학교변경'),
  qr('오늘 급식', '오늘'),
  qr('내일 급식', '내일'),
  qr('이번 주 급식', '이번주')
];

function qr(label, messageText) {
  return { label, action: 'message', messageText };
}

function kakaoText(text, quickReplies = []) {
  return {
    version: '2.0',
    template: {
      outputs: [{ simpleText: { text: String(text).slice(0, 990) } }],
      quickReplies
    }
  };
}

function getUserId(body) {
  return body?.userRequest?.user?.id || body?.userRequest?.user?.properties?.appUserId || 'anonymous';
}

function getUtterance(body) {
  return (body?.userRequest?.utterance || '').trim();
}

function yyyymmdd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function addDays(base, n) {
  const d = new Date(base.getTime());
  d.setDate(d.getDate() + n);
  return d;
}

function getMonday(date) {
  const d = new Date(date.getTime());
  const day = d.getDay(); // 0 Sun, 1 Mon
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function cleanDishName(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\([^)]*\)/g, '')
    .replace(/\d+\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitDishes(menu) {
  return String(menu || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .split(/\n+/)
    .map(cleanDishName)
    .filter(Boolean);
}

function regionFromAddress(addr, officeName) {
  const source = `${officeName || ''} ${addr || ''}`;
  const regions = ['서울','부산','대구','인천','광주','대전','울산','세종','경기','강원','충북','충남','전북','전남','경북','경남','제주'];
  for (const r of regions) if (source.includes(r)) return r;
  return officeName || '';
}

async function neisFetch(url) {
  const res = await fetch(url);
  const text = await res.text();
  try { return JSON.parse(text); } catch (e) { throw new Error('NEIS response is not JSON: ' + text.slice(0, 200)); }
}

async function searchSchools(keyword) {
  if (!NEIS_API_KEY) throw new Error('NEIS_API_KEY is not set');
  const url = new URL(SCHOOL_API);
  url.searchParams.set('KEY', NEIS_API_KEY);
  url.searchParams.set('Type', 'json');
  url.searchParams.set('pIndex', '1');
  url.searchParams.set('pSize', '10');
  url.searchParams.set('SCHUL_NM', keyword);
  const data = await neisFetch(url);
  const rows = data?.schoolInfo?.[1]?.row || [];
  return rows.map(r => ({
    name: r.SCHUL_NM,
    officeCode: r.ATPT_OFCDC_SC_CODE,
    schoolCode: r.SD_SCHUL_CODE,
    officeName: r.ATPT_OFCDC_SC_NM,
    address: r.ORG_RDNMA || r.ORG_RDNDA || '',
    region: regionFromAddress(r.ORG_RDNMA || r.ORG_RDNDA || '', r.ATPT_OFCDC_SC_NM)
  }));
}

async function getMeal(school, date) {
  if (!NEIS_API_KEY) throw new Error('NEIS_API_KEY is not set');
  const url = new URL(MEAL_API);
  url.searchParams.set('KEY', NEIS_API_KEY);
  url.searchParams.set('Type', 'json');
  url.searchParams.set('pIndex', '1');
  url.searchParams.set('pSize', '5');
  url.searchParams.set('ATPT_OFCDC_SC_CODE', school.officeCode);
  url.searchParams.set('SD_SCHUL_CODE', school.schoolCode);
  url.searchParams.set('MLSV_YMD', date);
  const data = await neisFetch(url);
  const rows = data?.mealServiceDietInfo?.[1]?.row || [];
  if (!rows.length) return null;
  const lunch = rows.find(r => String(r.MMEAL_SC_NM || '').includes('중식')) || rows[0];
  return {
    date,
    mealType: lunch.MMEAL_SC_NM || '급식',
    dishes: splitDishes(lunch.DDISH_NM),
    calories: lunch.CAL_INFO || '',
    nutrition: lunch.NTR_INFO || '',
    origin: lunch.ORPLC_INFO || ''
  };
}

function actionButtons(role) {
  // 학부모에게는 급식 조회 결과 아래에 저녁 추천과 장보기 목록이 함께 표시됩니다.
  // 그래서 별도의 '저녁추천', '장보기' 버튼은 기본 메뉴에서 제외했습니다.
  return [qr('오늘 급식', '오늘'), qr('내일 급식', '내일'), qr('이번 주 급식', '이번주'), qr('학교 변경', '학교변경')];
}

function startGuide() {
  return kakaoText(
`🍱 급식톡 사용을 시작할게요.

먼저 학교를 등록해주세요.
아래 [학교등록] 버튼을 누른 뒤, 학교명을 입력하면 됩니다.

예)
백양고등학교
남천중학교
서울고등학교

검색이 안 되면 약칭보다 정식 학교명을 입력해주세요.
예) 00여중 → 00여자중학교

학교명이 같은 경우 지역과 주소를 보고 선택할 수 있어요.`,
    [qr('학교등록', '학교등록'), qr('학교변경', '학교변경'), qr('오늘 급식', '오늘'), qr('이번 주 급식', '이번주')]
  );
}

function askSchoolName(session) {
  session.awaitingSchool = true;
  session.searchResults = [];
  return kakaoText(
`등록할 학교명을 입력해주세요.

예)
백양고등학교
남천중학교
서울고등학교

학교명 일부만 입력해도 검색할 수 있지만,
검색이 안 되면 약칭 대신 정식 학교명으로 입력해주세요.
예) 00여중 → 00여자중학교`,
    [qr('도움말', '처음')]
  );
}

function schoolSearchResultMessage(keyword, results) {
  if (!results.length) {
    return kakaoText(
`'${keyword}' 검색 결과가 없어요.

학교명을 다시 입력해주세요.
학교 약칭보다는 나이스에 등록된 정식 학교명으로 검색하면 더 정확해요.
예) 00여중 → 00여자중학교
예) 남천중 → 남천중학교
예) 백양고 → 백양고등학교`,
      [qr('다시 검색', '학교등록'), qr('도움말', '처음')]
    );
  }
  const lines = results.map((s, i) => `${i + 1}. ${s.name} / ${s.region}\n   ${s.address || s.officeName}`).join('\n\n');
  const buttons = results.slice(0, 5).map((_, i) => qr(`${i + 1}번 선택`, `${i + 1}번`));
  buttons.push(qr('다시 검색', '학교등록'));
  return kakaoText(
`'${keyword}' 검색 결과예요.
이름이 같은 학교가 있을 수 있으니 지역과 주소를 확인한 뒤 번호를 선택해주세요.

${lines}`,
    buttons
  );
}

function selectSchool(session, idx) {
  const school = session.searchResults?.[idx];
  if (!school) {
    return kakaoText('선택 번호를 찾을 수 없어요. 검색 결과의 번호를 다시 선택해주세요.', [qr('다시 검색', '학교등록')]);
  }
  session.school = school;
  session.awaitingSchool = false;
  session.awaitingRole = true;
  return kakaoText(
`✅ ${school.name} / ${school.region}
${school.address || ''}

이 학교로 등록할게요.
어떤 사용자로 이용하시나요?`,
    [qr('학생', '학생'), qr('학부모', '학부모'), qr('학교 다시 등록', '학교등록')]
  );
}

function setRole(session, role) {
  if (!session.school) {
    session.awaitingSchool = true;
    return kakaoText('먼저 학교를 등록해주세요.', [qr('학교등록', '학교등록')]);
  }
  session.role = role;
  session.awaitingRole = false;
  return kakaoText(
`✅ ${session.school.name} / ${role}로 등록했어요.

이제 아래 버튼을 눌러 급식을 확인할 수 있어요.`,
    actionButtons(role)
  );
}

function formatMeal(school, meal, title, role) {
  if (!meal) {
    return kakaoText(`🍱 ${school.name}\n${title}\n\n등록된 급식 정보가 없어요.\n휴일, 방학, 재량휴업일이거나 아직 급식 정보가 올라오지 않았을 수 있어요.`, actionButtons(role));
  }
  const dishes = meal.dishes.length ? meal.dishes.join('\n') : '메뉴 정보 없음';
  let text = `🍱 ${school.name}\n${title} ${meal.mealType}\n\n${dishes}`;
  if (meal.calories) text += `\n\n🔥 ${meal.calories}`;
  if (role === '학부모') {
    const dinner = recommendDinner(meal.dishes);
    text += `\n\n🍽️ 저녁 추천\n${dinner.recommendations.join('\n')}`;
    text += `\n\n🛒 장보기\n${dinner.shopping.join(', ')}`;
  }
  return kakaoText(text, actionButtons(role));
}

async function formatWeek(school, role) {
  const monday = getMonday(new Date());
  const lines = [];
  const days = ['월','화','수','목','금'];
  for (let i = 0; i < 5; i++) {
    const date = yyyymmdd(addDays(monday, i));
    const meal = await getMeal(school, date).catch(() => null);
    const short = meal?.dishes?.length ? meal.dishes.slice(0, 4).join(' / ') : '급식 정보 없음';
    lines.push(`${days[i]} ${date.slice(4,6)}/${date.slice(6,8)}: ${short}`);
  }
  return kakaoText(`📅 ${school.name} 이번 주 급식표\n\n${lines.join('\n')}`, actionButtons(role));
}

function recommendDinner(dishes) {
  const joined = dishes.join(' ');
  if (/튀김|치킨|돈가스|탕수|핫도그|너겟/.test(joined)) {
    return { recommendations: ['1. 두부샐러드', '2. 계란찜', '3. 닭가슴살 채소볶음'], shopping: ['두부','계란','닭가슴살','양상추','오이'] };
  }
  if (/고기|돈육|돼지|소고기|불고기|제육|갈비/.test(joined)) {
    return { recommendations: ['1. 생선구이', '2. 두부조림', '3. 채소비빔밥'], shopping: ['생선','두부','상추','당근','애호박'] };
  }
  if (/카레|짜장|볶음밥|덮밥/.test(joined)) {
    return { recommendations: ['1. 맑은국과 나물반찬', '2. 닭가슴살 샐러드', '3. 된장국과 계란말이'], shopping: ['대파','계란','닭가슴살','나물','두부'] };
  }
  return { recommendations: ['1. 닭가슴살 채소볶음', '2. 두부된장국', '3. 계란찜과 나물반찬'], shopping: ['닭가슴살','두부','계란','시금치','대파'] };
}

async function handleMessage(userId, text) {
  const session = sessions.get(userId) || {};
  sessions.set(userId, session);
  const t = text.trim();

  if (!t || /^(처음|시작|메뉴|도움말|설정)$/i.test(t)) return startGuide();

  if (/^(학교등록|학교 등록|학교변경|학교 변경|학교 바꾸기|다시 검색)$/i.test(t)) {
    delete session.school;
    delete session.role;
    return askSchoolName(session);
  }

  // Explicit command: 학교등록 남천중학교
  const explicit = t.match(/^학교\s*등록\s+(.+)$/);
  if (explicit) {
    const keyword = explicit[1].trim();
    const results = await searchSchools(keyword);
    session.awaitingSchool = true;
    session.searchResults = results;
    return schoolSearchResultMessage(keyword, results);
  }

  // Selection number after search
  const numMatch = t.match(/^(\d+)\s*번?(?:\s*선택)?$/);
  if (numMatch && session.searchResults?.length) {
    return selectSchool(session, Number(numMatch[1]) - 1);
  }

  if (/^(학생|나는 학생|학생입니다)$/i.test(t)) return setRole(session, '학생');
  if (/^(학부모|부모|보호자|나는 학부모|학부모입니다)$/i.test(t)) return setRole(session, '학부모');

  // When waiting for school, treat any text as school keyword.
  // Also treat Korean school-looking terms as school keyword even if Kakao routes them here via fallback.
  if (session.awaitingSchool || /(?:초등학교|중학교|고등학교|초|중|고)$/.test(t)) {
    const keyword = t.replace(/^학교검색\s*/,'').trim();
    const results = await searchSchools(keyword);
    session.awaitingSchool = true;
    session.searchResults = results;
    return schoolSearchResultMessage(keyword, results);
  }

  if (/^(오늘|오늘급식|오늘 급식|급식)$/i.test(t)) {
    if (!session.school) return kakaoText('먼저 학교를 등록해주세요.', [qr('학교등록', '학교등록')]);
    const meal = await getMeal(session.school, yyyymmdd(new Date()));
    return formatMeal(session.school, meal, '오늘', session.role || '학생');
  }

  if (/^(내일|내일급식|내일 급식)$/i.test(t)) {
    if (!session.school) return kakaoText('먼저 학교를 등록해주세요.', [qr('학교등록', '학교등록')]);
    const meal = await getMeal(session.school, yyyymmdd(addDays(new Date(), 1)));
    return formatMeal(session.school, meal, '내일', session.role || '학생');
  }

  if (/^(이번주|이번 주|주간급식|이번주 급식|이번 주 급식)$/i.test(t)) {
    if (!session.school) return kakaoText('먼저 학교를 등록해주세요.', [qr('학교등록', '학교등록')]);
    return await formatWeek(session.school, session.role || '학생');
  }

  if (/^(저녁추천|저녁 추천|저녁메뉴|저녁 메뉴|오늘 저녁)$/i.test(t)) {
    if (!session.school) return kakaoText('먼저 학교를 등록해주세요.', [qr('학교등록', '학교등록')]);
    const meal = await getMeal(session.school, yyyymmdd(new Date()));
    const dinner = recommendDinner(meal?.dishes || []);
    return kakaoText(`🍽️ 오늘 저녁 추천\n\n${dinner.recommendations.join('\n')}\n\n🛒 장보기\n${dinner.shopping.join(', ')}`, actionButtons(session.role || '학부모'));
  }

  if (/^(장보기|장보기 목록|장보기리스트|재료|필요한 재료)$/i.test(t)) {
    if (!session.school) return kakaoText('먼저 학교를 등록해주세요.', [qr('학교등록', '학교등록')]);
    const meal = await getMeal(session.school, yyyymmdd(new Date()));
    const dinner = recommendDinner(meal?.dishes || []);
    return kakaoText(`🛒 장보기 목록\n\n${dinner.shopping.map(x => `□ ${x}`).join('\n')}`, actionButtons(session.role || '학부모'));
  }

  return kakaoText(
`제가 이해하지 못했어요.

학교를 등록하려면 [학교등록]을 누른 뒤 학교명을 입력해주세요.
검색이 안 되면 약칭보다 정식 학교명으로 입력하면 더 정확해요.
예) 00여중 → 00여자중학교
예) 남천중 → 남천중학교`,
    FALLBACK_BUTTONS
  );
}

app.get('/', (req, res) => res.send('geupsiktalk kakao skill server is running. Use POST /skill'));
app.get('/health', (req, res) => res.json({ ok: true, service: 'geupsiktalk', version: '5.0.0' }));
app.get('/test', async (req, res) => {
  try {
    const schoolKeyword = req.query.school || '백양고등학교';
    const date = req.query.date || yyyymmdd(new Date());
    const schools = await searchSchools(schoolKeyword);
    const school = schools[0] || null;
    const meal = school ? await getMeal(school, date) : null;
    res.json({ ok: true, query: { schoolKeyword, date }, schools, school, meal });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/skill', async (req, res) => {
  try {
    const userId = getUserId(req.body);
    const text = getUtterance(req.body);
    const reply = await handleMessage(userId, text);
    res.json(reply);
  } catch (e) {
    console.error(e);
    res.json(kakaoText(`처리 중 오류가 발생했어요.\n${e.message}`, [qr('처음으로', '처음'), qr('학교등록', '학교등록')]));
  }
});

app.listen(PORT, () => console.log(`geupsiktalk server listening on port ${PORT}`));
