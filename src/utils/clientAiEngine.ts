import { ChatMessage, FileAttachment, UserProfile } from '../types';

export interface ClientAiResponse {
  answer: string;
  reasoningSteps: string[];
}

// Typo & Missing Letter Normalizer for Uzbek language
export function normalizeUzbekFuzzy(text: string): { clean: string; normalized: string; words: string[] } {
  if (!text) return { clean: "", normalized: "", words: [] };

  const clean = text.toLowerCase()
    .replace(/[‘’`ʼ']/g, "'")
    .replace(/[^a-z0-9\s'а-яё]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = clean.split(" ").filter(Boolean).map(w => {
    // Greetings & how are you with dropped letters / colloquial forms
    if (/^(salm|slm|aslm|asslm|asalom|salom|alom|slom|salaw|salyam|salomaleykum)$/.test(w)) return "salom";
    if (/^(qale|qalay|qalaysiz|qales|qalesz|qaleysiz|qaley|qaleysan|qandaysz|qandey|qande|qalysz|qalesan|qanaqasiz|qanaqasz)$/.test(w)) return "qalaysiz";
    if (/^(ishla|ishlar|ishlarim|ishlarm|ishlariz|ishlaring|ishlarilar)$/.test(w)) return "ishlar";
    if (/^(gapla|gaplar|gaplariz|gaplaring)$/.test(w)) return "gaplar";
    if (/^(nma|nima|nme|nmala|nimalar)$/.test(w)) return "nima";
    if (/^(bita|bitta|bte)$/.test(w)) return "bitta";
    if (/^(qosa|qolsa|qsa|qogan|qolgan)$/.test(w)) return "qolsa";
    if (/^(tushub|tushib|tushp|tushgan|tushqan)$/.test(w)) return "tushib";
    if (/^(kiyin|keyn|keyin)$/.test(w)) return "keyin";
    if (/^(chunmayabdi|chunmayapti|tushunmayabdi|tushunmayapti|chunmeyapti|tushunmeyapti|chunmidi|tushunmidi)$/.test(w)) return "tushunmayapti";
    if (/^(chunmadim|tushunmadim|chunmiman|tushunmadm)$/.test(w)) return "tushunmadim";
    if (/^(chunasanmi|tushunasanmi|chunasan|chunsen|tushunsang)$/.test(w)) return "tushunasanmi";
    if (/^(kmsan|kimsan|kimsn)$/.test(w)) return "kimsan";
    if (/^(ismin|isming|isminng)$/.test(w)) return "isming";
    if (/^(blasan|bilasan|blesan|blsan)$/.test(w)) return "bilasan";
    if (/^(eslesanmi|eslaysanmi|eslaysami|eslisami|eslesami)$/.test(w)) return "eslaysanmi";
    if (/^(eslap|eslab|eslep|eslb)$/.test(w)) return "eslab";
    if (/^(yodinda|yodingda|yodda)$/.test(w)) return "yodingda";
    if (/^(taniysanmi|tanisanmi|taniysami|tanisami)$/.test(w)) return "taniysanmi";
    if (/^(yaxshmz|yaxshimiz|yaxshimz|yaxshi|yahshi)$/.test(w)) return "yaxshi";
    if (/^(tinclikmi|tinchlikmi|tinchmi|tinlikmi|tinch)$/.test(w)) return "tinchlikmi";
    if (/^(dastr|dastur|dasturi)$/.test(w)) return "dastur";
    if (/^(dastrlash|dasturlash|programlash)$/.test(w)) return "dasturlash";
    if (/^(dastrchi|dasturchi|programist)$/.test(w)) return "dasturchi";
    if (/^(obhavo|havo)$/.test(w)) return "ob-havo";
    if (/^(ozingda|ozingizda|uzingda|o'zingda|ozinda)$/.test(w)) return "o'zingda";
    if (/^(qvosan|qilyapsan|qvosz|qilyapsiz|qilyabsan|qilvosan)$/.test(w)) return "qilyapsan";
    if (/^(bomasam|bolmasam|bmasam|bo'lmasa|bomasa)$/.test(w)) return "bo'lmasam";
    if (/^(muallifin|muallifing|avtoring|yaratuvchin|yaratuvching)$/.test(w)) return "muallifing";
    if (/^(yratgan|yaratgan|yasagan|qilgan|ishlabchiqqan)$/.test(w)) return "yaratgan";
    if (/^(fikirlasin|fikrlasin|fikirlash|fikrlash|oylasin|o'ylasin)$/.test(w)) return "fikrlasin";
    if (/^(matori|motor|motori)$/.test(w)) return "matori";
    if (/^(gapir|gapirvor|aytvoring|aytvor|aytibber)$/.test(w)) return "gapir";
    if (/^(suhbatlashsin|gaplashsin|gapirsin|suhbatlashaylik|gaplashaylik)$/.test(w)) return "suhbatlashsin";
    return w;
  });

  return { clean, normalized: words.join(" "), words };
}

export function generateClientResponse(params: {
  query: string;
  user: UserProfile | null;
  attachments?: FileAttachment[];
  history?: ChatMessage[];
}): ClientAiResponse {
  const { query, user, attachments = [] } = params;
  const userFirstName = user?.firstName?.trim() || "";
  const fuzzy = normalizeUzbekFuzzy(query);
  const norm = fuzzy.normalized;
  const rawLower = query.toLowerCase().trim();

  const greeting = userFirstName ? `Assalomu alaykum, **${userFirstName}**! 😊` : `Assalomu alaykum! 😊`;

  const reasoningSteps: string[] = [
    `1. Foydalanuvchi so'rovi qabul qilindi: "${query}"`,
  ];

  if (norm !== fuzzy.clean) {
    reasoningSteps.push(`2. Imlo va tushib qolgan harflar tahlili (Fuzzy NLP): xatoliklar avtomatik to'g'rilandi -> "${norm}"`);
  }

  if (attachments.length > 0) {
    reasoningSteps.push(`2.1. ${attachments.length} ta fayl/tasvir yuklandi: ${attachments.map(a => a.name).join(", ")}`);
  }

  reasoningSteps.push(`3. UZUNITED AI xotirasi va universal bilimlar sintezi yakunlandi.`);

  // 1. Files & Images Analysis
  if (attachments.length > 0) {
    const file = attachments[0];
    if (file.isImage) {
      return {
        answer: `${greeting}\n\nSiz yuborgan tasvir qabul qilindi (${(file.size / 1024).toFixed(1)} KB). Rasmda aynan qaysi ob'ekt, matn yoki savolni tahlil qilish kerakligini aytsangiz, aniq va lo'nda tushuntirib beraman. 🖼️✨`,
        reasoningSteps,
      };
    } else {
      return {
        answer: `${greeting}\n\n**"${file.name}"** hujjati qabul qilindi. Ushbu fayl bo'yicha qanday vazifani (qisqa xulosa, kod tekshiruvi yoki tahlil) bajarish kerak? 📄👍`,
        reasoningSteps,
      };
    }
  }

  // 2. Creators / Authors (FAQAT foydalanuvchi bevosita so'ragandagina aytiladi!)
  const isDirectAiCreatorQuestion = 
    (norm.includes("seni") || norm.includes("ai") || norm.includes("botni") || norm.includes("dasturni")) &&
    (norm.includes("kim yaratgan") || norm.includes("muallifing") || norm.includes("yaratuvching") || norm.includes("kim qilgan") || norm.includes("kim yasagan")) ||
    norm === "kim yaratgan seni" ||
    norm === "muallifing kim" ||
    norm === "yaratuvching kim" ||
    rawLower === "seni kim yaratgan" ||
    rawLower === "kim yaratgan seni";

  if (isDirectAiCreatorQuestion) {
    return {
      answer: `Meni **Afzalbek Nematov** va **Ozodbek Shohobiddinovlar** yaratishgan. 🤝✨`,
      reasoningSteps,
    };
  }

  // 2b. "Qale ishla", "Ishlar qanaqa", "Qalaysiz ishlar", "Salom ishla"
  const isGreetingAndInquiry = 
    (norm.includes("qalaysiz") && norm.includes("ishlar")) ||
    (norm.includes("salom") && norm.includes("ishlar")) ||
    norm.includes("ishlar qanaqa") ||
    norm.includes("ishlar qalay") ||
    norm.includes("ishlar yaxshimi") ||
    (norm.includes("ishlar") && (norm.includes("yaxshi") || norm.includes("zo'r") || norm.includes("qanday")));

  if (isGreetingAndInquiry) {
    return {
      answer: userFirstName 
        ? `Salom, **${userFirstName}**! 😊 Rahmat, ishlar juda yaxshi, joyida ketyapti! O'zingizda nima gaplar, ishlar, o'qishlar tinchmi, charchamayapsizmi? 👍✨` 
        : `Salom! 😊 Rahmat, ishlar juda yaxshi, joyida! O'zingiz tinchmisiz, kayfiyatlar qalay, nimalar bilan bandsiz? 👍✨`,
      reasoningSteps,
    };
  }

  // 3. User questions about dropped letters / thinking / so'z matori / suhbatlashish
  if (
    norm.includes("so'z matori") || 
    norm.includes("soz matori") || 
    norm.includes("matori") ||
    norm.includes("fikrlasin") || 
    norm.includes("fikirlasin") ||
    norm.includes("harflar tushib") || 
    norm.includes("harf tushib") || 
    norm.includes("tushunmayapti") || 
    norm.includes("tushunmayabdi") ||
    norm.includes("bitta harf") ||
    norm.includes("suhbatlashsin") ||
    norm.includes("gaplashsin") ||
    rawLower.includes("harf tush") ||
    rawLower.includes("chunmay")
  ) {
    return {
      answer: `Albatta, gapingiz judayam o'rinli! 😊 Men har bir so'zingizni shunchaki quruq emas, balki chuqur fikrlab, qaysi harfi tushib qolgan bo'lsa ham asl ma'nosini to'liq anglab javob beradigan qilib yangilandim. 💡\n\n«So'z matori» va so'z boyligim yetarli — xohlagan mavzuda insondek erkin, samimiy va jonli suhbatlashamiz! Bemalol o'zingizga qulay tarzda yozavering. Bugun qaysi mavzuda gaplashamiz? 🚀✨`,
      reasoningSteps,
    };
  }

  // 4. Memory queries & Remember commands
  if (
    (norm.includes("men haqimda") && (norm.includes("bilasan") || norm.includes("eslaysanmi"))) ||
    norm.includes("meni eslaysanmi") ||
    norm.includes("meni taniysanmi") ||
    norm.includes("nimani eslab qolding") ||
    norm.includes("xotirangda nima bor")
  ) {
    const prefs = user?.learnedPreferences || [];
    let text = `${greeting} Men sizni va suhbatlarimiz tarixini eslab qolaman! 🧠\n\n`;
    if (user?.firstName) text += `👤 **Ismingiz:** ${user.firstName} ${user.lastName || ""}\n`;
    if (user?.email) text += `📧 **Profilingiz:** ${user.email}\n`;
    if (user?.birthYear) text += `🎂 **Tug'ilgan yilingiz:** ${user.birthYear}-yil\n`;
    if (prefs.length > 0) {
      text += `\n✨ **Eslab qolingan faktlar:**\n` + prefs.map(p => `• ${p}`).join("\n");
    } else {
      text += `\nHozircha qo'shimcha shaxsiy xotira yozuvlari yo'q. Biror narsani eslab qolishimni istasangiz: *«Shuni eslab qol: ...»* deb yozishingiz mumkin. 💡`;
    }
    return {
      answer: text,
      reasoningSteps,
    };
  }

  if (norm.includes("eslab qol") || norm.includes("yodingda saqla") || norm.includes("yodingda tut")) {
    const item = query.replace(/^(?:iltimos\s+)?(?:shuni\s+|buni\s+)?(?:eslab\s+qol|eslap\s+qol|yodingda\s+saqla|yodinda\s+saqla)(?:\s*[:, -]?\s*)/i, "").trim();
    return {
      answer: `Tushundim, buni doimiy xotiramda eslab qoldim: **«${item || "Ko'rsatilgan ma'lumot"}»**. 🧠 Keyingi barcha suhbatlarimizda ham buni eslab turaman! ✨`,
      reasoningSteps,
    };
  }

  // 5. Bot Identity
  if (norm.includes("sen kimsan") || norm.includes("isming nima") || norm.includes("noming nima") || norm === "kimsan") {
    return {
      answer: `Men **UZUNITED AI** man — inson bilan insondek jonli, samimiy va har qanday xatolik yoki harf tushib qolishini erkin tushunadigan universal sun'iy intellekt assistentiman. 😊 Sizga qanday yordam bera olaman?`,
      reasoningSteps,
    };
  }

  // 6. Greetings & Casual Chat (with dropped letters handled: "salm", "slm", "aslm", "qalysz", "ishla qanaqa", "nma gap")
  if (
    norm.startsWith("salom") || 
    norm.startsWith("assalom") || 
    norm.startsWith("qalaysiz") || 
    norm.includes("ishlar qanaqa") ||
    norm.includes("nima gap") ||
    norm.includes("tinchlikmi") ||
    norm === "qalaysiz"
  ) {
    if (norm.includes("ishlar") || norm.includes("nima gap") || norm.includes("tinchlikmi")) {
      return {
        answer: userFirstName 
          ? `Hamma ishlar yaxshi, rahmat, ${userFirstName}! 👍 O'zingizda nima yangiliklar, tinchlikmi?` 
          : `Hamma ishlar yaxshi, rahmat! 👍 O'zingizda nima yangiliklar, kayfiyatlar yaxshimi? 😊`,
        reasoningSteps,
      };
    }
    return {
      answer: userFirstName 
        ? `Salom, **${userFirstName}**! 😊 Rahmat, yaxshiman. O'zingizda nima gaplar, qanday yordam bera olaman?` 
        : `Salom! 😊 Rahmat, yaxshiman. O'zingizda nima gaplar, qanday yordam bera olaman? ✨`,
      reasoningSteps,
    };
  }

  // 7. Request for stickers/emojis explicitly
  if (norm.includes("stiker") || norm.includes("emoji")) {
    return {
      answer: `Albatta! 😊 Suhbatimiz yanada jonli, samimiy va chiroyli bo'lishi uchun har zamonda bir (me'yorida va o'rinli) chiroyli stiker va emojilardan foydalanib boraman! 🚀✨`,
      reasoningSteps,
    };
  }

  // 8. Business Plan / Startups
  if (norm.includes("biznes") || norm.includes("startap") || norm.includes("investitsiya") || norm.includes("reja")) {
    return {
      answer: `Startapni muvaffaqiyatli yo'lga qo'yish uchun 3 ta asosiy qadam: 🚀\n\n1. **Muammo va bozor:** Mijozning haqiqiy og'riqli muammosini aniqlab, qulay taklif shakllantirish;\n2. **MVP versiya:** Katta mablag' sarflamay, dastlabki ishchi modelni tez ishlab chiqarish;\n3. **Mijozlar fikri:** Dastlabki mijozlar tahlili orqali mahsulotni sayqallash.\n\nSiz aynan qaysi sohada biznes boshlamoqchisiz? 💡`,
      reasoningSteps,
    };
  }

  // 9. Programming / Code
  if (norm.includes("python") || norm.includes("javascript") || norm.includes("kod") || norm.includes("dastur") || norm.includes("react") || norm.includes("sql")) {
    return {
      answer: `Dasturlash bo'yicha toza va zamonaviy yechim: 💻\n\n\`\`\`python
# Qisqa va samarali kod
def process_data(items):
    return [item.strip() for item in items if item]
\`\`\`\n\nKodingizdagi aniq xatolik yoki loyiha vazifasini yozsangiz, darhol ko'rib beraman! 🚀`,
      reasoningSteps,
    };
  }

  // 10. General World Knowledge / Questions
  return {
    answer: `«${query}» bo'yicha tushundim! 😊\n\nUshbu mavzuning asosiy mohiyati tizimli yondashuv va aniq rejalashtirishga tayanadi. Sizni ushbu masalaning aynan qaysi jihati ko'proq qiziqtirmoqda? 🎯`,
    reasoningSteps,
  };
}
