const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.PORT || 10000;
const NEIS_API_KEY = process.env.NEIS_API_KEY || '';

const sessions = new Map();

const ALLERGY_MAP = {
  '1': '난류',
  '2': '우유',
  '3': '메밀',
  '4': '땅콩',
  '5': '대두',
  '6': '밀',
  '7': '고등어',
  '8': '게',
  '9': '새우',
  '10': '돼지고기',
  '11': '복숭아',
  '12': '토마토',
  '13': '아황산류',
  '14': '호두',
  '15': '닭고기',
  '16': '쇠고기',
  '17': '오징어',
  '18': '조개류',
  '19': '잣'
};

function kakaoText(text, quickReplies = []) {
  return {
    version: '2.0',
    template: {
      outputs: [{ simpleText: { text } }],
      quickReplies
    }
  };
}

function qr(label, messageText) {
  return { label, action: 'message', messageText };
}

const mainButtons = [
  qr('학교등록', '학교등록'),
  qr('오늘 급식', '오늘'),
  qr('내일 급식', '내일'),
  qr('이번 주 급식', '이번주'),
  qr('학교변경', '학교변경')
];

const roleButtons = [qr('학생', '학생'), qr('학부모', '학부모'), qr('학교 다시 등록', '학교등록')];
const afterButtons = [qr('오늘 급식', '오늘'), qr('내일 급식', '내일'), qr('이번 주 급식', '이번주'), qr('학교 변경', '학교변경')];

function getUserId(body) {
  return body?.userRequest?.user?.id || body?.bot?.id || 'local-test-user';
}

function getUtterance(body) {
  return (body?.userRequest?.utterance || '').trim();
}

function todayYmd(offsetDays = 0) {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  kst.setUTCDate(kst.getUTCDate() + offsetDays);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function weekDates() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay(); // 0 Sun, 1 Mon
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return [0, 1, 2, 3, 4].map(i => todayYmd(mondayOffset + i));
}

function formatDateKorean(ymd) {
  return `${ymd.slice(0,4)}.${ymd.slice(4,6)}.${ymd.slice(6,8)}`;
}

function normalizeSchoolQuery(text) {
  return text
    .replace(/^학교등록\s*/,'')
    .replace(/^학교\s*등록\s*/,'')
    .replace(/^학교검색\s*/,'')
    .trim();
}

function isSchoolNameCandidate(text) {
  if (!text) return false;
  if (/^(처음|시작|설정|도움말|메뉴|학교등록|학교 등록|학교변경|학교 변경|학교 바꾸기|오늘|오늘급식|급식|내일|내일급식|이번주|이번 주|주간급식|학생|학부모|부모|보호자)$/i.test(text)) return false;
  if (/^[1-5](번)?(\s*선택)?$/.test(text)) return false;
  return /(초|중|고|학교|여중|여고|남중|남고)$/.test(text) || text.length >= 2;
}

async function searchSchools(query) {
  const url = 'https://open.neis.go.kr/hub/schoolInfo';
  const res = await axios.get(url, {
    params: {
      KEY: NEIS_API_KEY,
      Type: 'json',
      pIndex: 1,
      pSize: 20,
      SCHUL_NM: query
    },
    timeout: 10000
  });
  const rows = res.data?.schoolInfo?.[1]?.row || [];
  return rows.map(r => ({
    name: r.SCHUL_NM,
    officeCode: r.ATPT_OFCDC_SC_CODE,
    schoolCode: r.SD_SCHUL_CODE,
    officeName: r.ATPT_OFCDC_SC_NM,
    address: r.ORG_RDNMA || r.ORG_RDNDA || '',
    region: (r.ATPT_OFCDC_SC_NM || '').replace('광역시교육청','').replace('특별시교육청','').replace('특별자치시교육청','').replace('도교육청','').replace('특별자치도교육청','')
  }));
}

async function getMeals(school, ymd) {
  const url = 'https://open.neis.go.kr/hub/mealServiceDietInfo';
  const res = await axios.get(url, {
    params: {
      KEY: NEIS_API_KEY,
      Type: 'json',
      pIndex: 1,
      pSize: 20,
      ATPT_OFCDC_SC_CODE: school.officeCode,
      SD_SCHUL_CODE: school.schoolCode,
      MLSV_YMD: ymd
    },
    timeout: 10000
  });
  const rows = res.data?.mealServiceDietInfo?.[1]?.row || [];
  const order = { '조식': 1, '중식': 2, '석식': 3 };
  return rows
    .sort((a, b) => (order[a.MMEAL_SC_NM] || 99) - (order[b.MMEAL_SC_NM] || 99))
    .map(r => ({
      date: r.MLSV_YMD,
      mealType: r.MMEAL_SC_NM,
      dishesRaw: r.DDISH_NM || '',
      origin: r.ORPLC_INFO || '',
      nutrition: r.NTR_INFO || '',
      calories: r.CAL_INFO || ''
    }));
}

function pickLunchOrFirst(meals) {
  if (!Array.isArray(meals) || !meals.length) return null;
  return meals.find(m => m.mealType === '중식') || meals[0];
}

function cleanDishLineKeepAllergy(line) {
  return line
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDishLines(dishesRaw) {
  if (!dishesRaw) return [];
  return dishesRaw
    .replace(/<br\s*\/?>/gi, '\n')
    .split('\n')
    .map(cleanDishLineKeepAllergy)
    .filter(Boolean);
}

function extractAllergyNumbers(lines) {
  const found = new Set();
  for (const line of lines) {
    const matches = line.match(/\b(?:1[0-9]|[1-9])\b/g) || [];
    for (const m of matches) {
      if (ALLERGY_MAP[m]) found.add(m);
    }
  }
  return Array.from(found).sort((a,b) => Number(a)-Number(b));
}

function allergySummary(numbers) {
  if (!numbers.length) return '표시된 알레르기 번호가 없어요.';
  return numbers.map(n => `${n}.${ALLERGY_MAP[n]}`).join(' · ');
}

function allergyLegend() {
  return '알레르기 번호: 1난류 2우유 3메밀 4땅콩 5대두 6밀 7고등어 8게 9새우 10돼지고기 11복숭아 12토마토 13아황산류 14호두 15닭고기 16쇠고기 17오징어 18조개류 19잣';
}

function singleMealBlock(meal) {
  const lines = parseDishLines(meal.dishesRaw);
  const numbers = extractAllergyNumbers(lines);
  let text = `🍽️ ${meal.mealType}\n`;
  text += lines.length ? lines.map(v => `· ${v}`).join('\n') : '메뉴 정보 없음';
  if (meal.calories) text += `\n🔥 ${meal.calories}`;
  text += `\n⚠️ ${allergySummary(numbers)}`;
  return { text, lines, numbers };
}

function mealsToText(school, meals, ymd, role) {
  if (!meals || !meals.length) {
    return `🍱 ${school.name}\n${formatDateKorean(ymd)} 급식 정보가 없어요.\n\n휴일, 방학, 재량휴업일이거나 아직 급식 정보가 등록되지 않았을 수 있어요.`;
  }

  const blocks = meals.map(singleMealBlock);
  const allNumbers = Array.from(new Set(blocks.flatMap(b => b.numbers))).sort((a,b) => Number(a)-Number(b));

  let text = `🍱 ${school.name} 급식\n${formatDateKorean(ymd)}\n\n`;
  text += blocks.map(b => b.text).join('\n\n');
  text += `\n\n⚠️ 전체 포함 알레르기: ${allergySummary(allNumbers)}`;
  text += `\n${allergyLegend()}`;

  if (role === '학부모') {
    const baseMeal = pickLunchOrFirst(meals);
    const baseLines = baseMeal ? parseDishLines(baseMeal.dishesRaw) : [];
    const dinner = recommendDinner(baseLines.join(' '));
    const baseLabel = baseMeal?.mealType || '급식';
    text += `\n\n🍽️ 오늘 저녁 추천\n${baseLabel} 메뉴를 기준으로 추천했어요.\n${dinner.message}\n\n추천 메뉴\n1. ${dinner.menus[0]}\n2. ${dinner.menus[1]}\n3. ${dinner.menus[2]}\n\n🛒 장보기 목록\n${dinner.shopping.join(', ')}`;
  }
  return text;
}

function recommendDinner(menuText) {
  const fried = /(튀김|돈가스|탕수|치킨|너겟|강정)/.test(menuText);
  const meat = /(돼지|돈육|소고기|쇠고기|불고기|제육|닭|치킨)/.test(menuText);
  const spicy = /(김치|마라|고추|떡볶|매운|짬뽕)/.test(menuText);
  if (fried || meat || spicy) {
    return {
      message: '점심에 자극적이거나 든든한 메뉴가 있었어요. 저녁은 비교적 가볍게 구성해보세요.',
      menus: ['두부샐러드', '계란찜', '닭가슴살 채소볶음'],
      shopping: ['두부', '계란', '닭가슴살', '양상추', '오이', '파프리카']
    };
  }
  return {
    message: '점심이 비교적 무난해 보여요. 저녁은 단백질과 채소를 보완하면 좋아요.',
    menus: ['연어구이', '소고기채소볶음', '된장국과 나물반찬'],
    shopping: ['연어', '소고기', '양파', '애호박', '두부', '시금치']
  };
}

function helpText() {
  return `🍱 급식톡 사용 방법\n\n1. [학교등록] 버튼을 누르세요.\n2. 등록할 학교명을 입력하세요.\n   예) 남천중학교, 부산백양고등학교\n3. 이름이 같은 학교가 나오면 지역과 주소를 보고 번호를 선택하세요.\n4. 학생 또는 학부모를 선택하세요.\n5. 오늘, 내일, 이번 주 급식을 확인하세요.\n\n검색이 안 되면 약칭 대신 정식 학교명으로 입력해주세요.\n예) 00여중 → 00여자중학교\n예) 남천중 → 남천중학교\n예) 백양고 → 백양고등학교\n\n급식 메뉴의 숫자는 알레르기 번호예요.\n${allergyLegend()}`;
}

function schoolRegisterGuide() {
  return `등록할 학교명을 입력해주세요.\n\n예) 남천중학교\n예) 부산백양고등학교\n예) 서울고등학교\n\n학교명 일부만 입력해도 검색할 수 있어요.\n검색이 안 되면 약칭 대신 정식 학교명으로 입력해주세요.\n예) 00여중 → 00여자중학교\n예) 남천중 → 남천중학교\n예) 백양고 → 백양고등학교`;
}

async function handleSchoolSearch(userId, query) {
  const schools = await searchSchools(query);
  if (!schools.length) {
    return kakaoText(`'${query}' 검색 결과가 없어요.\n\n학교명을 다시 입력해주세요.\n학교 약칭보다는 나이스에 등록된 정식 학교명으로 검색하면 더 정확해요.\n예) 00여중 → 00여자중학교\n예) 남천중 → 남천중학교\n예) 백양고 → 백양고등학교`, [qr('학교등록', '학교등록'), qr('도움말', '도움말')]);
  }
  const session = sessions.get(userId) || {};
  session.searchResults = schools.slice(0, 5);
  session.awaitingSchoolName = false;
  session.awaitingSchoolChoice = true;
  sessions.set(userId, session);

  if (session.searchResults.length === 1) {
    session.school = session.searchResults[0];
    session.awaitingSchoolChoice = false;
    session.awaitingRole = true;
    sessions.set(userId, session);
    return kakaoText(`${session.school.name}을 찾았어요.\n\n${session.school.officeName}\n${session.school.address}\n\n어떤 사용자로 이용하시나요?`, roleButtons);
  }

  const body = session.searchResults.map((s, i) => `${i+1}. ${s.name} / ${s.region}\n   ${s.address}`).join('\n\n');
  const buttons = session.searchResults.map((_, i) => qr(`${i+1}번 선택`, `${i+1}번`));
  buttons.push(qr('다시 검색', '학교등록'));
  return kakaoText(`'${query}' 검색 결과예요.\n이름이 같은 학교가 있을 수 있으니 지역과 주소를 확인한 뒤 번호를 선택해주세요.\n\n${body}`, buttons);
}

async function handleUtterance(userId, utterance) {
  let session = sessions.get(userId) || {};

  if (!NEIS_API_KEY) {
    return kakaoText('서버에 NEIS_API_KEY가 설정되지 않았어요. Render 환경변수를 확인해주세요.');
  }

  if (/^(처음|시작|설정|도움말|메뉴)$/i.test(utterance)) {
    return kakaoText(helpText(), mainButtons);
  }

  if (/^(학교변경|학교 변경|학교 바꾸기)$/i.test(utterance)) {
    sessions.set(userId, {});
    return kakaoText('저장된 학교 정보를 초기화했어요.\n새로 등록할 학교명을 입력해주세요.', [qr('학교등록', '학교등록'), qr('도움말', '도움말')]);
  }

  if (/^(학교등록|학교 등록|학교 다시 등록)$/i.test(utterance)) {
    session.awaitingSchoolName = true;
    session.awaitingSchoolChoice = false;
    session.awaitingRole = false;
    delete session.searchResults;
    delete session.school;
    delete session.role;
    sessions.set(userId, session);
    return kakaoText(schoolRegisterGuide(), [qr('도움말', '도움말')]);
  }

  const regQuery = normalizeSchoolQuery(utterance);
  if (/^학교\s*등록/.test(utterance) || /^학교등록/.test(utterance) || /^학교검색/.test(utterance)) {
    if (!regQuery) return kakaoText(schoolRegisterGuide(), [qr('도움말', '도움말')]);
    return await handleSchoolSearch(userId, regQuery);
  }

  const choiceMatch = utterance.match(/^([1-5])번?(\s*선택)?$/);
  if (choiceMatch && session.searchResults?.length) {
    const idx = Number(choiceMatch[1]) - 1;
    if (idx >= 0 && idx < session.searchResults.length) {
      session.school = session.searchResults[idx];
      session.awaitingSchoolChoice = false;
      session.awaitingRole = true;
      sessions.set(userId, session);
      return kakaoText(`${session.school.name}을 선택했어요.\n\n${session.school.officeName}\n${session.school.address}\n\n어떤 사용자로 이용하시나요?`, roleButtons);
    }
  }

  if (/^(학생|나는 학생|학생입니다)$/i.test(utterance)) {
    if (!session.school) return kakaoText('먼저 학교를 등록해주세요.', [qr('학교등록', '학교등록')]);
    session.role = '학생';
    session.awaitingRole = false;
    sessions.set(userId, session);
    return kakaoText(`${session.school.name} / 학생으로 등록했어요.\n이제 오늘, 내일, 이번주 급식을 확인할 수 있어요.`, afterButtons);
  }

  if (/^(학부모|부모|보호자|나는 학부모|학부모입니다)$/i.test(utterance)) {
    if (!session.school) return kakaoText('먼저 학교를 등록해주세요.', [qr('학교등록', '학교등록')]);
    session.role = '학부모';
    session.awaitingRole = false;
    sessions.set(userId, session);
    return kakaoText(`${session.school.name} / 학부모로 등록했어요.\n급식 조회 시 저녁 추천과 장보기 목록도 함께 보여드릴게요.`, afterButtons);
  }

  if (/^(오늘|오늘급식|오늘 급식|급식|오늘 뭐 나와)$/i.test(utterance)) {
    if (!session.school) return kakaoText('먼저 학교를 등록해주세요.', [qr('학교등록', '학교등록')]);
    const ymd = todayYmd(0);
    const meals = await getMeals(session.school, ymd);
    return kakaoText(mealsToText(session.school, meals, ymd, session.role), afterButtons);
  }

  if (/^(내일|내일급식|내일 급식|내일 뭐 나와)$/i.test(utterance)) {
    if (!session.school) return kakaoText('먼저 학교를 등록해주세요.', [qr('학교등록', '학교등록')]);
    const ymd = todayYmd(1);
    const meals = await getMeals(session.school, ymd);
    return kakaoText(mealsToText(session.school, meals, ymd, session.role), afterButtons);
  }

  if (/^(이번주|이번 주|주간급식|이번주 급식|이번 주 급식)$/i.test(utterance)) {
    if (!session.school) return kakaoText('먼저 학교를 등록해주세요.', [qr('학교등록', '학교등록')]);
    const dates = weekDates();
    const labels = ['월', '화', '수', '목', '금'];
    const parts = [];
    for (let i=0; i<dates.length; i++) {
      const meals = await getMeals(session.school, dates[i]);
      if (!meals || !meals.length) {
        parts.push(`${labels[i]} ${formatDateKorean(dates[i])}\n급식 정보 없음`);
      } else {
        const dayBlocks = meals.map(meal => {
          const lines = parseDishLines(meal.dishesRaw);
          const nums = extractAllergyNumbers(lines);
          return `🍽️ ${meal.mealType}\n${lines.join(' / ')}\n⚠️ ${allergySummary(nums)}`;
        });
        parts.push(`${labels[i]} ${formatDateKorean(dates[i])}\n${dayBlocks.join('\n')}`);
      }
    }
    return kakaoText(`📅 ${session.school.name} 이번 주 급식표\n\n${parts.join('\n\n')}\n\n${allergyLegend()}`, afterButtons);
  }

  if (session.awaitingSchoolName || isSchoolNameCandidate(utterance)) {
    return await handleSchoolSearch(userId, utterance.trim());
  }

  return kakaoText('제가 할 수 있는 일이 아니에요.\n학교를 등록하거나 급식을 조회해보세요.', mainButtons);
}

app.get('/', (req, res) => res.type('text/plain').send('geupsiktalk kakao skill server is running. Use POST /skill'));
app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.get('/test', async (req, res) => {
  try {
    const schoolQuery = req.query.school || '백양고등학교';
    const date = req.query.date || todayYmd(0);
    const schools = await searchSchools(schoolQuery);
    const school = schools[0] || null;
    const meals = school ? await getMeals(school, date) : [];
    const lines = meals.flatMap(meal => parseDishLines(meal.dishesRaw));
    const allergyNumbers = extractAllergyNumbers(lines);
    res.json({ ok: true, query: schoolQuery, date, school, meals, lines, allergyNumbers, allergySummary: allergySummary(allergyNumbers) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, detail: err.response?.data || null });
  }
});

app.post('/skill', async (req, res) => {
  try {
    const userId = getUserId(req.body);
    const utterance = getUtterance(req.body);
    const response = await handleUtterance(userId, utterance);
    res.json(response);
  } catch (err) {
    console.error('skill error:', err.response?.data || err.stack || err.message);
    res.json(kakaoText('처리 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.', [qr('처음', '처음'), qr('학교등록', '학교등록') ]));
  }
});

app.listen(PORT, () => {
  console.log(`geupsiktalk server listening on port ${PORT}`);
});
