/**
 * Chinese for the interface, in one place. The components and renderers keep their English text;
 * this translates it on the way to the screen: `zh()` for what the canvases draw (label() calls
 * it), and `installChinese()` for the DOM (text nodes, titles, aria-labels and placeholders, kept
 * translated by a MutationObserver as React updates them). On unless the address has `?lang=en`.
 *
 * Lookups ignore case (the canvases write capitals). What a person typed or what the voice says
 * (lyrics, example sentences, IPA) is not in the table, so it stays as written.
 */
let on = typeof location === "undefined" || new URLSearchParams(location.search).get("lang") !== "en";

export function setChinese(v: boolean): void {
  on = v;
}

const T: Record<string, string> = {
  // ---- top bar
  "A voice grown from a simulated airway": "从模拟气道里长出来的声音",
  Mode: "模式",
  Play: "手动",
  Speak: "说话",
  Sing: "唱歌",
  Bestiary: "动物",
  Beatbox: "口技",
  Volume: "音量",
  Plugin: "插件",
  "Source code on GitHub": "GitHub 上的源代码",
  "CHIMERA as a CLAP, VST3 and AU plugin for your DAW": "CHIMERA 的 CLAP / VST3 / AU 插件版，可在编曲软件里用",
  "Share of the audio thread's time budget used by the simulation": "模拟占用音频线程时间的比例",
  "Starting…": "启动中…",
  Stop: "停止",
  "Try again": "重试",
  // ---- the head
  Body: "体型",
  Male: "男",
  Female: "女",
  Child: "童",
  "Adult male": "成年男性",
  "Adult female": "成年女性",
  "Body between male, female and child": "在男、女、童之间调体型",
  "Sound pressure": "声压",
  Airflow: "气流",
  Measurements: "测量",
  Grid: "网格",
  Labels: "标签",
  "Live vocal tract": "实时声道",
  "Live creature airway": "实时动物气道",
  "Vocal tract cross-section. Drag the tongue, tongue tip, jaw, lips, soft palate or larynx handles.": "声道剖面。可拖动舌面、舌尖、下巴、嘴唇、软腭或喉的控制点。",
  "Vocal tract in 3D. Drag to turn the head, scroll or pinch to zoom, double-click to go back to the starting view.": "三维声道。拖动转头，滚轮或双指缩放，双击复位。",
  Tongue: "舌头",
  "Tongue body": "舌面",
  "Tongue tip": "舌尖",
  Jaw: "下巴",
  Lips: "嘴唇",
  "Soft palate": "软腭",
  Larynx: "喉",
  Glottis: "声门",
  Velum: "软腭",
  Teeth: "牙齿",
  Nose: "鼻腔",
  Shut: "关闭",
  Closed: "闭合",
  Open: "打开",
  Lowered: "降下",
  Voiceless: "清音",
  // ---- Play
  Breathe: "送气",
  Whisper: "耳语",
  Tube: "气道",
  "Glottis to lips": "声门到嘴唇",
  "Vocal folds": "声带",
  "Slowed 100×": "慢放 100 倍",
  Spectrum: "频谱",
  Spectrogram: "声谱图",
  Vowels: "元音",
  Voice: "嗓音",
  Keys: "琴键",
  Pitch: "音高",
  Breath: "气息",
  Breathy: "气声",
  Pressed: "挤压",
  Fry: "气泡音",
  Rough: "粗糙",
  Vibrato: "颤音",
  Glide: "滑音",
  Bright: "明亮",
  Tone: "音色",
  Twang: "尖亮",
  "False folds": "假声带",
  Throat: "咽喉",
  Root: "舌根",
  "Tip curl": "卷舌",
  Mouth: "口腔",
  "Lips open": "开唇",
  Protrude: "撅唇",
  Rounding: "圆唇",
  Front: "前",
  Area: "声门开口",
  Flow: "气流",
  "Velum shut": "软腭关闭（不走鼻腔）",
  "Make a sound to see them vibrate": "发声后可以看到声带振动",
  "Start audio to see the sound": "发声后可以看到声音",
  Now: "现在",
  Ring: "共鸣",
  "Ring on": "共鸣开",
  "Ring off": "共鸣关",
  cents: "音分",
  semitones: "半音",
  "Vowel map. Drag to morph between vowels.": "元音图。拖动可在元音之间过渡。",
  "Keyboard. Computer keys A to semicolon play notes; Z and X change octave.": "键盘。电脑键 A 到分号弹音符，Z 和 X 换八度。",
  "Connecting…": "连接中…",
  "Blocked by the browser": "被浏览器阻止",
  "Plug one in": "请接上键盘",
  Off: "关",
  // ---- Speak
  Examples: "例句",
  Rate: "语速",
  Language: "语言",
  English: "英语",
  Turkish: "土耳其语",
  "Text is IPA": "按国际音标读",
  "Text to speak": "要说的文字",
  "Type something for the voice to say": "输入要让它说的话",
  "What to say": "说什么",
  "One line per note": "每个音符一行",
  "No words: the notes say nothing.": "没有文字：音符不会发声。",
  "Lines. Each note says the marked one; choose another to start there.": "各行文字。每个音符说标记的那一行，点别的行可从那里开始。",
  "Gestural score": "发音动作谱",
  "Gestural score of the current utterance: which articulator moves, when, and how they overlap": "当前这句话的发音动作谱：哪个器官何时动、如何重叠",
  "Speak something to see its gestures: which articulator moves, when, and how they overlap.": "说点什么，看每个发音器官何时动作、如何重叠。",
  Consonants: "辅音",
  "Between two vowels": "夹在两个元音之间",
  "Say it between two vowels": "夹在两个元音之间说出来",
  "Vowel around it": "两边的元音",
  Sound: "声音",
  Bilabial: "双唇",
  Bilab: "双唇",
  Labiodental: "唇齿",
  Labdent: "唇齿",
  Dental: "齿",
  Alveolar: "齿龈",
  Alveol: "齿龈",
  Postalveolar: "龈后",
  Postalv: "龈后",
  Retroflex: "卷舌",
  Retrofl: "卷舌",
  Palatal: "硬腭",
  Velar: "软腭",
  Uvular: "小舌",
  Pharyngeal: "咽",
  Pharyn: "咽",
  Glottal: "声门",
  Plosive: "塞音",
  Nasal: "鼻音",
  Trill: "颤音",
  Tap: "闪音",
  Fricative: "擦音",
  "Lat fric": "边擦音",
  "Lateral fricative": "边擦音",
  Approx: "近音",
  Approximant: "近音",
  Lateral: "边音",
  "Lateral approximant": "边近音",
  "Not said": "读不出",
  "No sound yet": "暂无此音",
  "Mark ignored": "忽略的符号",
  // ---- Sing
  Song: "歌曲",
  Tune: "曲调",
  Lyrics: "歌词",
  "Lyrics to sing": "要唱的歌词",
  "Type the words to sing": "输入要唱的歌词",
  Tempo: "速度",
  Key: "调",
  "Song voice": "歌声",
  "Record video": "录视频",
  "Record video:": "录视频：",
  "Sing it again and record the face into a video": "再唱一遍，并把脸部画面录成视频",
  Save: "保存",
  Share: "分享",
  "From the start": "从头",
  "No words: the keys sing “ah”.": "没有歌词：琴键唱“啊”。",
  "Held vowel: carries the previous syllable onto this note": "延长元音：把上一个音节延续到这个音符",
  "Syllables. Each note sings the marked one; choose another to start there.": "各音节。每个音符唱标记的那个，点别的可从那里开始。",
  "Piano roll: the notes played, their syllables, and the pitch actually sung": "钢琴卷帘：弹的音符、对应音节和实际唱出的音高",
  Dreamy: "梦幻",
  Joyful: "欢快",
  Somber: "沉郁",
  Playful: "俏皮",
  Gentle: "温柔",
  "Twinkle, twinkle": "小星星",
  breath: "换气",
  // ---- Beatbox
  Pads: "打击垫",
  Pattern: "节奏型",
  Beat: "节拍",
  Swing: "摇摆",
  "Play beat": "播放节拍",
  "Mic FX": "麦克风效果",
  "Close mic": "贴麦",
  "Close-mic effect: the bass, presence and squash of a mic held to the lips": "贴麦效果：话筒贴着嘴时的低频、临场感和压缩感",
  "Step sequencer": "步进音序器",
  "Beat pattern: one sound per step": "节奏型：每一步一个声音",
  "Your beat": "你的节奏",
  "Beat as text": "用文字写节奏",
  Bass: "低音",
  Follow: "跟随",
  Transport: "走带",
  "With host": "跟宿主",
  "Breath in": "吸气",
  "Breath out": "呼气",
  "Larynx piston": "喉活塞",
  "Tongue suction": "舌吸",
  Kick: "底鼓",
  "Hi-hat": "踩镲",
  "Open hat": "开镲",
  Snare: "军鼓",
  Rimshot: "边击",
  "Inward snare": "吸气军鼓",
  "Tongue click": "弹舌",
  "Lip pop": "唇爆",
  Crash: "吊镲",
  Hum: "哼鸣",
  "Lips burst on air the rising larynx compresses": "喉头上提压缩空气，双唇爆开",
  "Tongue-tip release into a short hiss": "舌尖放开，带一小段嘶声",
  "The hi-hat left ringing as a long hiss": "踩镲拖成一长段嘶声",
  "Lips burst, then the lower lip hisses against the teeth": "双唇爆开，然后下唇贴着牙齿嘶一声",
  "Back of the tongue bursts on larynx-compressed air": "喉头压缩空气，舌根爆开",
  "A sharp breath in past the back of the tongue": "从舌根处猛吸一口气",
  "Tongue seals a pocket, hollows it and pops": "舌头封住一个小腔，抽空后弹开",
  "Sealed lips, the jaw drops, the lips pop open": "双唇闭紧，下巴一落，嘴唇啵地弹开",
  "Back-of-tongue release into a long rounded hiss": "舌根放开，拖成一长段圆唇嘶声",
  "Hummed bass note through the nose": "从鼻腔哼出的低音",
  "Boots and cats": "动次打次",
  "Four on the floor": "四拍底鼓",
  Breakbeat: "碎拍",
  "Rimshot shuffle": "边击摇摆",
  "Clicks and pops": "弹舌与唇爆",
  "Hum bass": "哼鸣低音",
  // ---- Bestiary
  Creatures: "动物",
  Calls: "叫声",
  Controls: "控制",
  Airway: "气道",
  "Each tube unrolled": "每根管道拉直",
  "Held voice": "持续发声",
  "Keep the breath on and shape the sound with the controls": "保持送气，用控制项塑造声音",
  "What the keys play": "琴键弹什么",
  "At rest": "静止",
  "Not started": "未启动",
  "Airway tubes unrolled, lit by sound pressure": "拉直的气道，按声压点亮",
  "Creature airway: its outline, its airways lit by sound pressure, and its sound sources": "动物气道：轮廓、按声压点亮的气道和声源",
  Songbird: "鸣禽",
  "Weddell seal": "威德尔海豹",
  "American alligator": "美洲短吻鳄",
  "African elephant": "非洲象",
  "Two independent labial pairs in the syrinx, one per bronchus, each with its own pitch; a throat cavity tracks the note.": "鸣管里有两对独立的鸣膜，每条支气管一对，各唱各的音高；喉腔跟着音高变化。",
  "Laryngeal calls with an extreme range: trills glide down for seconds while their pulses slow.": "喉部发出的叫声，音域极宽：颤音一连下滑好几秒，脉冲越来越慢。",
  "A chaotic, very low laryngeal roar through a long, closed-mouthed tract; the whole body radiates.": "极低而混沌的喉部吼声，穿过闭着嘴的长声道；整个身体都在向外辐射声音。",
  "Infrasonic rumbles from huge vocal folds, routed through a two-metre trunk or the mouth; trumpets from a buzzing valve at the trunk entrance.": "巨大的声带发出次声隆隆声，从两米长的象鼻或嘴里出来；号声来自象鼻入口处振动的瓣膜。",
  "Pitch, left voice": "左声源音高",
  "Right voice interval": "右声源音程",
  "Left ↔ both ↔ right": "左 ↔ 双 ↔ 右",
  "Drive (pure → raspy)": "力度（纯净 → 沙哑）",
  "Labial tension": "鸣膜张力",
  "Air-sac pressure": "气囊压力",
  "Throat tracks note": "喉腔跟随音高",
  "Throat cavity size": "喉腔大小",
  "Beak gape": "张喙",
  "Pulse rate": "脉冲速率",
  "Pulsing depth": "脉冲深度",
  "Pulse duty": "脉冲占空比",
  Brightness: "明亮度",
  Roughness: "粗糙度",
  "Breath pressure": "气压",
  "Mouth opening": "张口",
  "Bifurcation (period doubling → chaos)": "分岔（倍周期 → 混沌）",
  "Nasal passage": "鼻道",
  "Hiss (open glottis)": "嘶声（声门打开）",
  "Rumble ↔ trumpet": "隆隆声 ↔ 号声",
  "Rumble pitch": "隆隆声音高",
  "Trumpet valve pitch": "号声瓣膜音高",
  "Mouth ↔ trunk": "嘴 ↔ 象鼻",
  Chaos: "混沌",
  "Flute phrase": "笛音乐句",
  "Wood-thrush style: three notes, then a two-voice shimmer": "林鸫式：三个音，然后是双声部的闪烁",
  "Canary trill": "金丝雀颤音",
  "16 notes a second, each a quick upsweep": "每秒 16 个音，每个都快速上滑",
  "Chirp cascade": "连串啁啾",
  "Falling chirps, faster and faster": "下行的啁啾，越来越快",
  "Finch buzz": "雀鸟嗡鸣",
  "Zebra-finch style: raspy, pulsed by mini-breaths": "斑胸草雀式：沙哑，被小口换气切成脉冲",
  "Descending trill": "下行颤音",
  "Several seconds falling from bright to subsonic, pulses slowing": "几秒钟内从明亮滑到次声，脉冲渐慢",
  "Laser chirp": "激光啁啾",
  "A 150 ms downward zap": "150 毫秒的下滑一击",
  "U whistle": "U 形哨音",
  "Dips and returns": "先降后回",
  Chug: "突突声",
  "Low, pulsed grunt": "低沉的脉冲咕噜声",
  Bellow: "咆哮",
  "Two seconds of chaotic roar, rising into full chaos": "两秒钟的混沌吼声，升到完全混沌",
  Growl: "低吼",
  "Short, rough warning": "短促粗糙的警告",
  Hiss: "嘶声",
  "Open mouth, open glottis: pure turbulence": "张嘴、声门打开：纯粹的湍流",
  "Water dance": "水舞",
  "Steady subsonic throb that shakes the water": "稳定的次声震动，把水面震起来",
  Rumble: "隆隆声",
  "Three seconds of infrasonic rumble through the trunk": "三秒钟从象鼻出来的次声隆隆声",
  Trumpet: "号声",
  "A brassy blast that bends up and breaks into chaos": "铜管般的一声，上扬后碎成混沌",
  Squeak: "尖叫",
  "Tensed, high valve buzz": "绷紧的高音瓣膜振动",
  Beak: "喙",
  Trachea: "气管",
  "Left bronchus": "左支气管",
  "Right bronchus": "右支气管",
  "Left voice": "左声源",
  "Right voice": "右声源",
  Nostrils: "鼻孔",
  Pharynx: "咽",
  Trunk: "象鼻",
  "Trunk valve": "象鼻瓣膜",
  "Shimmering two-note leads, arpeggio trills, glitchy chirps": "适合：闪烁的双音主旋律、琶音颤音、故障感啁啾",
  "Downlifters, laser zaps, acid-style sweeping leads": "适合：下行过渡音效、激光音、迷幻扫频主音",
  "Distorted sub drones, noise bass, impacts": "适合：失真的超低持续音、噪声贝斯、撞击声",
  "Sub-bass rumbles, distorted brass leads": "适合：超低频隆隆声、失真的铜管主音",
  st: "半音",
  Round: "圆唇",
  "Output spectrum: harmonics, the vocal tract's resonances and its formants": "输出频谱：泛音、声道共鸣和共振峰",
  "Area function of the simulated tube, lit by sound pressure": "模拟气道的粗细，按声压点亮",
  "Vocal folds seen from above, replayed slowly, with the glottal area and flow": "俯视的声带慢放，附声门开口和气流",
  "Waterfall spectrogram of the last two seconds of output": "最近两秒输出的瀑布声谱图",
  // ---- duet page
  "Loading the song…": "正在加载歌曲…",
  "Position in the song": "歌曲进度",
  Pause: "暂停",
  Again: "再来一遍",
};

/** texts with numbers or names in them */
const PATTERNS: [RegExp, string][] = [
  [/^Engine load (\d+) %(.*)$/i, "引擎负载 $1 %$2"],
  [/^OPEN (\d+)%$/i, "一个周期里张开 $1%"],
  [/^VELUM OPEN ([\d.]+) CM²$/i, "软腭打开 $1 cm²（走鼻腔）"],
  [/^TRACT ([\d.]+) CM$/i, "声道长 $1 cm"],
  [/^MOUTH ([\d.]+) CM²$/i, "口开 $1 cm²"],
  [/^F0 ([\d.]+) HZ$/i, "音高 $1 Hz"],
  [/^LUNGS (-?[\d.]+) CMH₂O$/i, "肺压 $1 cmH₂O"],
  [/^VOICED ([\d.]+) HZ$/i, "浊音 $1 Hz"],
  [/^NOISE AT ([\d.]+) CM$/i, "噪声位于 $1 cm 处"],
  [/^NOTE (\S+) ([\d.]+) HZ$/i, "音符 $1 $2 Hz"],
  [/^NEXT: (.+)$/i, "下一个：$1"],
  [/^(\d+) S AGO$/i, "$1 秒前"],
  [/^([\d.]+) CM²$/i, "$1 cm²"],
  [/^([\d.]+) MM²$/i, "$1 mm²"],
  [/^(.+), step (\d+)$/i, "$1，第 $2 步"],
  [/^([^:]+): (.+)\. Key (\d)$/i, "$1：$2。按键 $3"],
  [/^B kick, t hat, Pf snare, K rimshot, \^K inward, ! click, m hum \(m:43 sets its note\), \. rest\. Up to (\d+) steps\.$/i, "B 底鼓，t 踩镲，Pf 军鼓，K 边击，^K 吸气军鼓，! 弹舌，m 哼鸣（m:43 指定音高），. 休止。最多 $1 步。"],
  [/^(.+) controls$/i, "$1 的控制项"],
  [/^(.+) pages$/i, "$1 分页"],
  [/^Note (\S+)$/i, "音符 $1"],
  [/^Syllable (.+)$/i, "音节 $1"],
  [/^Sing from “(.+)”$/i, "从“$1”开始唱"],
  [/^Say from “(.+)”$/i, "从“$1”开始说"],
  [/^Not said: (.+)$/i, "读不出：$1"],
  [/^The voice engine could not load: (.+)$/i, "声音引擎加载失败：$1"],
  [/^MIDI keyboard: (.+?)\. Press to disconnect\.$/i, "MIDI 键盘：$1。点一下断开。"],
  [/^MIDI keyboard: (.+?)\. Press to connect \(the browser asks for access\)\.$/i, "MIDI 键盘：$1。点一下连接（浏览器会请求权限）。"],
  [/^(.+) — drag between male, female and child; arrow keys step$/i, "$1 — 在男、女、童之间拖动；方向键微调"],
];

const UP: Record<string, string> = {};
for (const [k, v] of Object.entries(T)) UP[k.toUpperCase()] = v;

/** texts seen with no translation, for finding what the table lacks (`window.__zhMissing`) */
const missing = new Set<string>();

function lookup(text: string): string | null {
  const core = text.trim();
  if (!core || !/[A-Za-z]{2}/.test(core) || /[一-鿿]/.test(core)) return null;
  const hit = UP[core.toUpperCase()];
  if (hit) return text.replace(core, hit);
  for (const [re, to] of PATTERNS) {
    if (!re.test(core)) continue;
    // a name inside a pattern (a creature, a keyboard's state) is translated too
    const out = core.replace(re, to).replace(/[A-Za-z][A-Za-z ,'’-]+[A-Za-z…]/g, (w) => UP[w.toUpperCase()] ?? w);
    return text.replace(core, out);
  }
  if (core.length < 160) missing.add(core);
  return null;
}

/** For the canvases: the Chinese for a label, or the label as it is. */
export function zh(text: string): string {
  if (!on) return text;
  return lookup(text) ?? text;
}

/** Chinese sits wider than the tracked capitals it replaces: no extra letter spacing for it. */
export const isChinese = (text: string): boolean => /[一-鿿]/.test(text);

const ATTRS = ["title", "aria-label", "placeholder"];
/** what people type or the voice says: left alone */
const SKIP = "textarea, input, [contenteditable], script, style, .say, .lyrics, .syl, .ipa, .mic-help, .mic-status";

function node(n: Node): void {
  if (n.nodeType === Node.TEXT_NODE) {
    const p = n.parentElement;
    if (!p || p.closest(SKIP)) return;
    const t = n.nodeValue ?? "";
    const z = lookup(t);
    if (z !== null && z !== t) n.nodeValue = z;
    return;
  }
  if (n.nodeType !== Node.ELEMENT_NODE) return;
  const el = n as Element;
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (!v) continue;
    const z = lookup(v);
    if (z !== null && z !== v) el.setAttribute(a, z);
  }
  if (el.matches("script, style")) return;
  for (const c of Array.from(el.childNodes)) node(c);
}

/** Translate the page and keep it translated as it changes. */
export function installChinese(root: HTMLElement = document.body): void {
  if (!on) return;
  document.documentElement.lang = "zh-CN";
  (window as unknown as { __zhMissing: Set<string> }).__zhMissing = missing;
  node(root);
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "characterData") node(m.target);
      else if (m.type === "attributes") node(m.target);
      else m.addedNodes.forEach(node);
    }
  }).observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
