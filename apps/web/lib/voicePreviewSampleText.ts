/**
 * 音色目录里的「语言」字段（与 minimax 系统表 / voiceCatalogUtils 一致）→ 用于 TTS 试听的短句。
 * 句子尽量短、自然，便于听辨音色；未知语言回退到 uiFallback（通常随界面语言变化）。
 */
const VOICE_PREVIEW_SAMPLE_BY_CATALOG_LANG: Record<string, string> = {
  内置: "欢迎收听我的播客节目",
  "中文 (普通话)": "欢迎收听我的播客节目",
  "中文 (粤语)": "歡迎收聽我嘅播客節目。",
  英文: "Welcome to my podcast.",
  日文: "私のポッドキャストへようこそ。",
  韩文: "제 팟캐스트에 오신 것을 환영합니다.",
  法文: "Bienvenue dans mon podcast.",
  德文: "Willkommen zu meinem Podcast.",
  西班牙文: "Bienvenidos a mi podcast.",
  葡萄牙文: "Bem-vindos ao meu podcast.",
  印尼文: "Selamat datang di podcast saya.",
  俄文: "Добро пожаловать на мой подкаст.",
  意大利文: "Benvenuti al mio podcast.",
  阿拉伯文: "مرحبًا بكم في بودكاستي.",
  土耳其文: "Podcastime hoş geldiniz.",
  乌克兰文: "Ласкаво просимо до мого подкасту.",
  荷兰文: "Welkom bij mijn podcast.",
  越南文: "Chào mừng bạn đến với podcast của tôi.",
  泰文: "ยินดีต้อนรับสู่พอดแคสต์ของฉัน",
  波兰文: "Cześć, zapraszam do mojego podcastu.",
  罗马尼亚文: "Bine ai venit la podcastul meu.",
  希腊文: "Καλώς ήρθατε στο podcast μου.",
  捷克文: "Vítejte u mého podcastu.",
  芬兰文: "Tervetuloa podcastiini.",
  印地文: "मेरे पॉडकास्ट में आपका स्वागत है।"
};

export function voicePreviewSampleForCatalogLanguage(catalogLanguage: string, uiFallback: string): string {
  const k = String(catalogLanguage || "").trim();
  if (!k) return uiFallback;
  const sample = VOICE_PREVIEW_SAMPLE_BY_CATALOG_LANG[k];
  if (k === "其他") return uiFallback;
  const trimmed = String(sample || "").trim();
  return trimmed || uiFallback;
}
