"""
配置管理模块
管理 API Key、默认音色、BGM 路径等配置常量
"""

import os
import json

# ========== API Keys ==========
# 统一 API Key（文本、TTS、音色克隆、图像生成都使用同一个）
MINIMAX_API_KEY = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJHcm91cE5hbWUiOiJNTembqOmcsiIsIlVzZXJOYW1lIjoiTU3pm6jpnLIiLCJBY2NvdW50IjoiIiwiU3ViamVjdElEIjoiMTg2MjExOTYxNjMwNjc0NTUxNyIsIlBob25lIjoiIiwiR3JvdXBJRCI6IjE4NjIxMTk2MTYzMDI1NTEyMTMiLCJQYWdlTmFtZSI6IiIsIk1haWwiOiJ5dWx1QG1pbmltYXhpLmNvbSIsIkNyZWF0ZVRpbWUiOiIyMDI1LTEwLTA3IDIxOjEyOjMyIiwiVG9rZW5UeXBlIjoxLCJpc3MiOiJtaW5pbWF4In0.gB_fIHCvO_BcSAd2kJbr87n7NAFjWGoWaahAa6fR5i23uZZ2wk6-CBW06UIthAwD3314JzDd-mGemzdLM64geA1nycwrMlAxAV4wCp4s6Dc7e2CPBjxgjyzkbnqLF05xLLHmuheOr0qbafJ4G_vObmeBxmGDuVDwN4fvh4I4SZhPnfmv0CLdW4ZqX8qtbotBudL8NJO7E6wrw-GNWaQ6UZndG3U-11TYvvc-O4ho6RIfEKYIwf7ijg6Apuv1bQWYuTLWNAmvIjAuZSBSIdK-G6yACZ09QESwB3kNWqwigDOmdD2BIhhtd0AbTKrIImp0tURba55wSDv96ZBj0Cm2ew"

# 保留旧的变量名以兼容现有代码
MINIMAX_TEXT_API_KEY = MINIMAX_API_KEY
MINIMAX_OTHER_API_KEY = MINIMAX_API_KEY

# ========== 默认音色配置 ==========
# 扩展方式：
# 1. 在下方字典中增加一项：键（key）= 前端/表单里使用的短名（小写英文为宜，如 nova）；
#    必填字段 voice_id 须与 MiniMax 控制台「语音合成 / 音色」里可用的 voice_id 一致。
# 2. name、gender、description 仅用于前端展示；TTS 只读 voice_id。
# 3. 保存后重启后端；前端「生成播客」页会从 GET /api/default-voices 自动拉取列表，无需改前端。
# 4. 已克隆音色仍走「自定义音色 / 已保存音色ID」，与这里的预设并列。
DEFAULT_VOICES = {
    "mini": {
        "name": "Mini",
        "gender": "female",
        "voice_id": "moss_audio_aaa1346a-7ce7-11f0-8e61-2e6e3c7ee85d",
        "description": "女声 - 活泼亲切"
    },
    "max": {
        "name": "Max",
        "gender": "male",
        "voice_id": "moss_audio_ce44fc67-7ce3-11f0-8de5-96e35d26fb85",
        "description": "男声 - 稳重专业"
    },
    "male_qn_qingse": {
        "name": "青涩青年音色",
        "gender": "male",
        "voice_id": "male-qn-qingse",
        "description": "中文 (普通话) · 青涩青年音色",
    },
    "male_qn_jingying": {
        "name": "精英青年音色",
        "gender": "male",
        "voice_id": "male-qn-jingying",
        "description": "中文 (普通话) · 精英青年音色",
    },
    "male_qn_badao": {
        "name": "霸道青年音色",
        "gender": "male",
        "voice_id": "male-qn-badao",
        "description": "中文 (普通话) · 霸道青年音色",
    },
    "male_qn_daxuesheng": {
        "name": "青年大学生音色",
        "gender": "male",
        "voice_id": "male-qn-daxuesheng",
        "description": "中文 (普通话) · 青年大学生音色",
    },
    "female_shaonv": {
        "name": "少女音色",
        "gender": "female",
        "voice_id": "female-shaonv",
        "description": "中文 (普通话) · 少女音色",
    },
    "female_yujie": {
        "name": "御姐音色",
        "gender": "female",
        "voice_id": "female-yujie",
        "description": "中文 (普通话) · 御姐音色",
    },
    "female_chengshu": {
        "name": "成熟女性音色",
        "gender": "female",
        "voice_id": "female-chengshu",
        "description": "中文 (普通话) · 成熟女性音色",
    },
    "female_tianmei": {
        "name": "甜美女性音色",
        "gender": "female",
        "voice_id": "female-tianmei",
        "description": "中文 (普通话) · 甜美女性音色",
    },
    "male_qn_qingse_jingpin": {
        "name": "青涩青年音色-beta",
        "gender": "male",
        "voice_id": "male-qn-qingse-jingpin",
        "description": "中文 (普通话) · 青涩青年音色-beta",
    },
    "male_qn_jingying_jingpin": {
        "name": "精英青年音色-beta",
        "gender": "male",
        "voice_id": "male-qn-jingying-jingpin",
        "description": "中文 (普通话) · 精英青年音色-beta",
    },
    "male_qn_badao_jingpin": {
        "name": "霸道青年音色-beta",
        "gender": "male",
        "voice_id": "male-qn-badao-jingpin",
        "description": "中文 (普通话) · 霸道青年音色-beta",
    },
    "male_qn_daxuesheng_jingpin": {
        "name": "青年大学生音色-beta",
        "gender": "male",
        "voice_id": "male-qn-daxuesheng-jingpin",
        "description": "中文 (普通话) · 青年大学生音色-beta",
    },
    "female_shaonv_jingpin": {
        "name": "少女音色-beta",
        "gender": "female",
        "voice_id": "female-shaonv-jingpin",
        "description": "中文 (普通话) · 少女音色-beta",
    },
    "female_yujie_jingpin": {
        "name": "御姐音色-beta",
        "gender": "female",
        "voice_id": "female-yujie-jingpin",
        "description": "中文 (普通话) · 御姐音色-beta",
    },
    "female_chengshu_jingpin": {
        "name": "成熟女性音色-beta",
        "gender": "female",
        "voice_id": "female-chengshu-jingpin",
        "description": "中文 (普通话) · 成熟女性音色-beta",
    },
    "female_tianmei_jingpin": {
        "name": "甜美女性音色-beta",
        "gender": "female",
        "voice_id": "female-tianmei-jingpin",
        "description": "中文 (普通话) · 甜美女性音色-beta",
    },
    "cute_boy": {
        "name": "可爱男童",
        "gender": "male",
        "voice_id": "cute_boy",
        "description": "中文 (普通话) · 可爱男童",
    },
    "lovely_girl": {
        "name": "萌萌女童",
        "gender": "female",
        "voice_id": "lovely_girl",
        "description": "中文 (普通话) · 萌萌女童",
    },
    "cartoon_pig": {
        "name": "卡通猪小琪",
        "gender": "male",
        "voice_id": "cartoon_pig",
        "description": "中文 (普通话) · 卡通猪小琪",
    },
    "bingjiao_didi": {
        "name": "病娇弟弟",
        "gender": "female",
        "voice_id": "bingjiao_didi",
        "description": "中文 (普通话) · 病娇弟弟",
    },
    "junlang_nanyou": {
        "name": "俊朗男友",
        "gender": "male",
        "voice_id": "junlang_nanyou",
        "description": "中文 (普通话) · 俊朗男友",
    },
    "chunzhen_xuedi": {
        "name": "纯真学弟",
        "gender": "male",
        "voice_id": "chunzhen_xuedi",
        "description": "中文 (普通话) · 纯真学弟",
    },
    "lengdan_xiongzhang": {
        "name": "冷淡学长",
        "gender": "male",
        "voice_id": "lengdan_xiongzhang",
        "description": "中文 (普通话) · 冷淡学长",
    },
    "badao_shaoye": {
        "name": "霸道少爷",
        "gender": "male",
        "voice_id": "badao_shaoye",
        "description": "中文 (普通话) · 霸道少爷",
    },
    "tianxin_xiaoling": {
        "name": "甜心小玲",
        "gender": "female",
        "voice_id": "tianxin_xiaoling",
        "description": "中文 (普通话) · 甜心小玲",
    },
    "qiaopi_mengmei": {
        "name": "俏皮萌妹",
        "gender": "female",
        "voice_id": "qiaopi_mengmei",
        "description": "中文 (普通话) · 俏皮萌妹",
    },
    "wumei_yujie": {
        "name": "妩媚御姐",
        "gender": "female",
        "voice_id": "wumei_yujie",
        "description": "中文 (普通话) · 妩媚御姐",
    },
    "diadia_xuemei": {
        "name": "嗲嗲学妹",
        "gender": "female",
        "voice_id": "diadia_xuemei",
        "description": "中文 (普通话) · 嗲嗲学妹",
    },
    "danya_xuejie": {
        "name": "淡雅学姐",
        "gender": "female",
        "voice_id": "danya_xuejie",
        "description": "中文 (普通话) · 淡雅学姐",
    },
    "chinese_mandarin_news_anchor": {
        "name": "新闻女声",
        "gender": "female",
        "voice_id": "Chinese (Mandarin)_News_Anchor",
        "description": "中文 (普通话) · 新闻女声",
    },
    "chinese_mandarin_mature_woman": {
        "name": "傲娇御姐",
        "gender": "female",
        "voice_id": "Chinese (Mandarin)_Mature_Woman",
        "description": "中文 (普通话) · 傲娇御姐",
    },
    "chinese_mandarin_unrestrained_young_man": {
        "name": "不羁青年",
        "gender": "male",
        "voice_id": "Chinese (Mandarin)_Unrestrained_Young_Man",
        "description": "中文 (普通话) · 不羁青年",
    },
    "arrogant_miss": {
        "name": "嚣张小姐",
        "gender": "female",
        "voice_id": "Arrogant_Miss",
        "description": "中文 (普通话) · 嚣张小姐",
    },
    "robot_armor": {
        "name": "机械战甲",
        "gender": "male",
        "voice_id": "Robot_Armor",
        "description": "中文 (普通话) · 机械战甲",
    },
    "chinese_mandarin_kind_hearted_antie": {
        "name": "热心大婶",
        "gender": "female",
        "voice_id": "Chinese (Mandarin)_Kind-hearted_Antie",
        "description": "中文 (普通话) · 热心大婶",
    },
    "chinese_mandarin_hk_flight_attendant": {
        "name": "港普空姐",
        "gender": "female",
        "voice_id": "Chinese (Mandarin)_HK_Flight_Attendant",
        "description": "中文 (普通话) · 港普空姐",
    },
    "chinese_mandarin_humorous_elder": {
        "name": "搞笑大爷",
        "gender": "male",
        "voice_id": "Chinese (Mandarin)_Humorous_Elder",
        "description": "中文 (普通话) · 搞笑大爷",
    },
    "chinese_mandarin_gentleman": {
        "name": "温润男声",
        "gender": "male",
        "voice_id": "Chinese (Mandarin)_Gentleman",
        "description": "中文 (普通话) · 温润男声",
    },
    "chinese_mandarin_warm_bestie": {
        "name": "温暖闺蜜",
        "gender": "female",
        "voice_id": "Chinese (Mandarin)_Warm_Bestie",
        "description": "中文 (普通话) · 温暖闺蜜",
    },
    "chinese_mandarin_male_announcer": {
        "name": "播报男声",
        "gender": "male",
        "voice_id": "Chinese (Mandarin)_Male_Announcer",
        "description": "中文 (普通话) · 播报男声",
    },
    "chinese_mandarin_sweet_lady": {
        "name": "甜美女声",
        "gender": "female",
        "voice_id": "Chinese (Mandarin)_Sweet_Lady",
        "description": "中文 (普通话) · 甜美女声",
    },
    "chinese_mandarin_southern_young_man": {
        "name": "南方小哥",
        "gender": "male",
        "voice_id": "Chinese (Mandarin)_Southern_Young_Man",
        "description": "中文 (普通话) · 南方小哥",
    },
    "chinese_mandarin_wise_women": {
        "name": "阅历姐姐",
        "gender": "female",
        "voice_id": "Chinese (Mandarin)_Wise_Women",
        "description": "中文 (普通话) · 阅历姐姐",
    },
    "chinese_mandarin_gentle_youth": {
        "name": "温润青年",
        "gender": "male",
        "voice_id": "Chinese (Mandarin)_Gentle_Youth",
        "description": "中文 (普通话) · 温润青年",
    },
    "chinese_mandarin_warm_girl": {
        "name": "温暖少女",
        "gender": "female",
        "voice_id": "Chinese (Mandarin)_Warm_Girl",
        "description": "中文 (普通话) · 温暖少女",
    },
    "chinese_mandarin_kind_hearted_elder": {
        "name": "花甲奶奶",
        "gender": "female",
        "voice_id": "Chinese (Mandarin)_Kind-hearted_Elder",
        "description": "中文 (普通话) · 花甲奶奶",
    },
    "chinese_mandarin_cute_spirit": {
        "name": "憨憨萌兽",
        "gender": "female",
        "voice_id": "Chinese (Mandarin)_Cute_Spirit",
        "description": "中文 (普通话) · 憨憨萌兽",
    },
    "chinese_mandarin_radio_host": {
        "name": "电台男主播",
        "gender": "male",
        "voice_id": "Chinese (Mandarin)_Radio_Host",
        "description": "中文 (普通话) · 电台男主播",
    },
    "chinese_mandarin_lyrical_voice": {
        "name": "抒情男声",
        "gender": "male",
        "voice_id": "Chinese (Mandarin)_Lyrical_Voice",
        "description": "中文 (普通话) · 抒情男声",
    },
    "chinese_mandarin_straightforward_boy": {
        "name": "率真弟弟",
        "gender": "male",
        "voice_id": "Chinese (Mandarin)_Straightforward_Boy",
        "description": "中文 (普通话) · 率真弟弟",
    },
    "chinese_mandarin_sincere_adult": {
        "name": "真诚青年",
        "gender": "male",
        "voice_id": "Chinese (Mandarin)_Sincere_Adult",
        "description": "中文 (普通话) · 真诚青年",
    },
    "chinese_mandarin_gentle_senior": {
        "name": "温柔学姐",
        "gender": "female",
        "voice_id": "Chinese (Mandarin)_Gentle_Senior",
        "description": "中文 (普通话) · 温柔学姐",
    },
    "chinese_mandarin_stubborn_friend": {
        "name": "嘴硬竹马",
        "gender": "female",
        "voice_id": "Chinese (Mandarin)_Stubborn_Friend",
        "description": "中文 (普通话) · 嘴硬竹马",
    },
    "chinese_mandarin_crisp_girl": {
        "name": "清脆少女",
        "gender": "female",
        "voice_id": "Chinese (Mandarin)_Crisp_Girl",
        "description": "中文 (普通话) · 清脆少女",
    },
    "chinese_mandarin_pure_hearted_boy": {
        "name": "清澈邻家弟弟",
        "gender": "male",
        "voice_id": "Chinese (Mandarin)_Pure-hearted_Boy",
        "description": "中文 (普通话) · 清澈邻家弟弟",
    },
    "chinese_mandarin_soft_girl": {
        "name": "柔和少女",
        "gender": "female",
        "voice_id": "Chinese (Mandarin)_Soft_Girl",
        "description": "中文 (普通话) · 柔和少女",
    },
    "cantonese_professionalhost_f": {
        "name": "专业女主持",
        "gender": "female",
        "voice_id": "Cantonese_ProfessionalHost（F)",
        "description": "中文 (粤语) · 专业女主持",
    },
    "cantonese_gentlelady": {
        "name": "温柔女声",
        "gender": "female",
        "voice_id": "Cantonese_GentleLady",
        "description": "中文 (粤语) · 温柔女声",
    },
    "cantonese_professionalhost_m": {
        "name": "专业男主持",
        "gender": "female",
        "voice_id": "Cantonese_ProfessionalHost（M)",
        "description": "中文 (粤语) · 专业男主持",
    },
    "cantonese_playfulman": {
        "name": "活泼男声",
        "gender": "male",
        "voice_id": "Cantonese_PlayfulMan",
        "description": "中文 (粤语) · 活泼男声",
    },
    "cantonese_cutegirl": {
        "name": "可爱女孩",
        "gender": "female",
        "voice_id": "Cantonese_CuteGirl",
        "description": "中文 (粤语) · 可爱女孩",
    },
    "cantonese_kindwoman": {
        "name": "善良女声",
        "gender": "female",
        "voice_id": "Cantonese_KindWoman",
        "description": "中文 (粤语) · 善良女声",
    },
    "santa_claus": {
        "name": "Santa Claus",
        "gender": "male",
        "voice_id": "Santa_Claus",
        "description": "英文 · Santa Claus",
    },
    "grinch": {
        "name": "Grinch",
        "gender": "male",
        "voice_id": "Grinch",
        "description": "英文 · Grinch",
    },
    "rudolph": {
        "name": "Rudolph",
        "gender": "male",
        "voice_id": "Rudolph",
        "description": "英文 · Rudolph",
    },
    "arnold": {
        "name": "Arnold",
        "gender": "male",
        "voice_id": "Arnold",
        "description": "英文 · Arnold",
    },
    "charming_santa": {
        "name": "Charming Santa",
        "gender": "male",
        "voice_id": "Charming_Santa",
        "description": "英文 · Charming Santa",
    },
    "charming_lady": {
        "name": "Charming Lady",
        "gender": "female",
        "voice_id": "Charming_Lady",
        "description": "英文 · Charming Lady",
    },
    "sweet_girl": {
        "name": "Sweet Girl",
        "gender": "female",
        "voice_id": "Sweet_Girl",
        "description": "英文 · Sweet Girl",
    },
    "cute_elf": {
        "name": "Cute Elf",
        "gender": "female",
        "voice_id": "Cute_Elf",
        "description": "英文 · Cute Elf",
    },
    "attractive_girl": {
        "name": "Attractive Girl",
        "gender": "female",
        "voice_id": "Attractive_Girl",
        "description": "英文 · Attractive Girl",
    },
    "serene_woman": {
        "name": "Serene Woman",
        "gender": "female",
        "voice_id": "Serene_Woman",
        "description": "英文 · Serene Woman",
    },
    "english_trustworthy_man": {
        "name": "Trustworthy Man",
        "gender": "male",
        "voice_id": "English_Trustworthy_Man",
        "description": "英文 · Trustworthy Man",
    },
    "english_graceful_lady": {
        "name": "Graceful Lady",
        "gender": "female",
        "voice_id": "English_Graceful_Lady",
        "description": "英文 · Graceful Lady",
    },
    "english_aussie_bloke": {
        "name": "Aussie Bloke",
        "gender": "male",
        "voice_id": "English_Aussie_Bloke",
        "description": "英文 · Aussie Bloke",
    },
    "english_whispering_girl": {
        "name": "Whispering girl",
        "gender": "female",
        "voice_id": "English_Whispering_girl",
        "description": "英文 · Whispering girl",
    },
    "english_diligent_man": {
        "name": "Diligent Man",
        "gender": "male",
        "voice_id": "English_Diligent_Man",
        "description": "英文 · Diligent Man",
    },
    "english_gentle_voiced_man": {
        "name": "Gentle-voiced man",
        "gender": "male",
        "voice_id": "English_Gentle-voiced_man",
        "description": "英文 · Gentle-voiced man",
    }


}

# ========== BGM 配置，此处可修改为自己BGM ==========
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BGM_DIR = os.path.join(BASE_DIR, "assets")

BGM_FILES = {
    "bgm01": os.path.join(BGM_DIR, "bgm01.wav"),
    "bgm02": os.path.join(BGM_DIR, "bgm02.wav")
}

# 欢迎语音配置，此处可修改自己的sogan
WELCOME_TEXT = "欢迎收听AI播客节目"
WELCOME_VOICE_ID = DEFAULT_VOICES["mini"]["voice_id"]  # 使用 Mini 音色

# ========== MiniMax API 端点配置 ==========
MINIMAX_API_BASE = "https://api.minimax.io"
MINIMAX_API_ENDPOINTS = {
    "text_completion": "https://api.minimaxi.com/v1/text/chatcompletion_v2",
    "embeddings": "https://api.minimaxi.com/v1/embeddings",
    "tts": "https://api.minimaxi.com/v1/t2a_v2",
    "voice_clone": "https://api.minimax.chat/v1/voice_clone",
    "file_upload": "https://api.minimax.chat/v1/files/upload",
    "image_generation": "https://api.minimaxi.com/v1/image_generation"
}


# MINIMAX_API_BASE = "https://api.minimax.chat/v1"
# MINIMAX_API_ENDPOINTS = {
#     "text_completion": "https://api.minimax.chat/v1/text/chatcompletion_v2",
#     "tts": "https://api.minimax.chat/v1/t2a_v2",
#     "voice_clone": "https://api.minimax.chat/v1/voice_clone",
#     "file_upload": "https://api.minimax.chat/v1/files/upload",
#     "image_generation": "https://api.minimax.chat/v1/image_generation"
# }

# ========== 模型配置 ==========
MODELS = {
    "text": "MiniMax-M2-Preview",
    "tts": "speech-2.5-hd-preview",
    "voice_clone": "speech-02-turbo",
    "image": "image-01-live"
}
# MODELS = {
#     "text": "abab6.5s-chat",
#     "tts": "speech-01-turbo",
#     "voice_clone": "speech-01-turbo",
#     "image": "image-01-live"
# }

# ========== 播客生成配置 ==========
PODCAST_CONFIG = {
    # 长文案分段：是否在每段生成后（第 2 段起）可选调用 API，用「边界补丁」优化段首衔接
    # heuristic_only=True 时仅在检测到重复开场倾向时调用，节省费用
    "segment_boundary_api_polish": False,
    "segment_boundary_api_heuristic_only": True,
    # 脚本生成目标字数（正文，不含 Speaker 前缀）；与前端、大模型输出能力对齐
    "script_target_chars_default": 200,
    "script_target_chars_min": 200,
    "script_target_chars_max": 5000,
    # 单段生成的进阶目标：优先尝试更长单段，失败再自动降档
    "script_target_chars_preferred_max": 2800,
    "long_script_target_chars_max": 10000,
    "style": "轻松幽默",
    "speakers": ["Speaker1", "Speaker2"],
}

# ========== 超时配置（秒）==========
TIMEOUTS = {
    "segment_boundary_polish": 55,
    "url_parsing": 30,
    "pdf_parsing": 30,
    "voice_clone": 60,
    "script_generation": 120,
    "tts_per_sentence": 30,
    "cover_prompt_generation": 60,  # 封面 Prompt 生成超时
    "image_generation": 90  # 图像生成超时（增加到90秒）
}

# ========== 文件路径配置 ==========
UPLOAD_DIR = os.path.join(BASE_DIR, "backend", "uploads")
OUTPUT_DIR = os.path.join(BASE_DIR, "backend", "outputs")
VOICE_STORE_FILE = os.path.join(OUTPUT_DIR, "saved_voices.json")

# 确保目录存在
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

# 初始化音色持久化文件
if not os.path.exists(VOICE_STORE_FILE):
    with open(VOICE_STORE_FILE, "w", encoding="utf-8") as f:
        json.dump([], f, ensure_ascii=False)

# ========== Voice ID 生成配置 ==========
VOICE_ID_CONFIG = {
    "prefix": "customVoice",
    "min_length": 8,
    "max_length": 256,
    "allowed_chars": "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
}

# ========== TTS 音频配置 ==========
TTS_AUDIO_SETTINGS = {
    "sample_rate": 32000,
    "bitrate": 128000,
    "format": "mp3",
    "channel": 1
}

# ========== TTS 限流与重试配置 ==========
TTS_RATE_LIMIT_CONFIG = {
    "rpm_limit": 10,            # 主动限速：每分钟最多发起多少次 TTS 请求
    "max_retries": 5,           # 遇到限流时最多重试次数
    "initial_backoff_sec": 2.0, # 首次退避秒数
    "max_backoff_sec": 20.0,    # 退避上限秒数
    "jitter_sec": 0.5           # 随机抖动，避免并发雪崩
}

# ========== 图像生成配置 ==========
IMAGE_GENERATION_CONFIG = {
    "style_type": "漫画",
    "style_weight": 1,
    "aspect_ratio": "1:1",
    "prompt_optimizer": True,
    "n": 1
}

# ========== 日志配置 ==========
LOG_LEVEL = "INFO"
LOG_FORMAT = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
