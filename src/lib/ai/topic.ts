/**
 * Topic guard: keeps the assistant to civil, structural, construction and architecture work WITHOUT calling a model,
 * so off-topic questions cost no tokens. Deterministic keyword rules (English, Bangla and US terms):
 *  - a message with civil/construction or engineering-maths vocabulary is allowed;
 *  - a follow-up in a conversation that is already about civil work is allowed ("and for 3 storeys?", "explain step 2");
 *  - greetings and "what can you do" get a short local reply (no model call);
 *  - anything else is refused locally with a hint on what CivilMate does.
 * Attachments count: a document or image with no off-topic request is allowed (site photos, soil reports).
 */
import type { ChatMessage } from "./types";

// Civil / construction / architecture vocabulary. Stems end in \w* so plurals and verb forms match.
const CIVIL = new RegExp([
  String.raw`\b(civil|structur\w*|construct\w*|build\w*|engineer\w*|architect\w*|contractor\w*|site\w*|project\w*|consultan\w*|surveyor\w*|survey\w*)\b`,
  String.raw`\b(concrete|cement\w*|mortar|grout|rebar\w*|reinforc\w*|steel|rod|rods|stirrup\w*|tie\w*|beam\w*|girder\w*|lintel\w*|joist\w*|rafter\w*|truss\w*|purlin\w*|column\w*|pillar\w*|slab\w*|footing\w*|foundation\w*|pile\w*|pier\w*|raft|mat foundation|basement\w*|retaining|wall\w*|masonry|brick\w*|block|blocks|blockwork|plaster\w*|render\w*|tile\w*|paint\w*|floor\w*|roof\w*|stair\w*|ramp\w*|door\w*|window\w*|formwork|shuttering|scaffold\w*|curing|compaction|backfill\w*|excavat\w*|earthwork\w*|grading|dewater\w*)\b`,
  String.raw`\b(soil\w*|geotech\w*|bearing|settlement\w*|spt|cbr|clay|silt|sand|gravel|aggregate\w*|khoa|stone chips?|borehole\w*|consolidat\w*|liquefaction|slope stability|retaining)\b`,
  String.raw`\b(load\w*|stress\w*|strain\w*|moment\w*|shear|bending|deflect\w*|torsion|buckl\w*|axial|tension|compression|seismic|earthquake|wind load|snow load|dead load|live load|span\w*|cantilever\w*|frame\w*|bracing|connection\w*|weld\w*|bolt\w*|anchor\w*|prestress\w*|post-?tension\w*|precast)\b`,
  String.raw`\b(road\w*|highway\w*|street\w*|pavement\w*|asphalt|bitumen\w*|carpeting|subgrade|sub-?base|base course|esal|traffic|curve\w*|superelevation|sight distance|gradient|camber|bridge\w*|culvert\w*|embankment\w*|railway\w*|airport\w*|runway\w*|parking)\b`,
  String.raw`\b(drain\w*|sewer\w*|sewage|sanitar\w*|septic|soak ?pit|stormwater|storm water|runoff|rainfall|hydrolog\w*|hydraul\w*|pipe\w*|plumbing|water supply|water tank|reservoir|canal\w*|dam|dams|embankment|flood\w*|irrigation|tube ?wells?|deep ?wells?|water wells?|pump\w*|manning|detention|catch ?basin|manhole\w*)\b`,
  String.raw`\b(plan|plans|planning|layout\w*|design\w*|drawing\w*|draft\w*|sketch\w*|elevation\w*|section\w*|detail\w*|cad|autocad|revit|dxf|bim|house\w*|home|homes|duplex|apartment\w*|flat|flats|villa\w*|storey\w*|\d+\s*-?\s*stor(?:e?y|ies)|room\w*|bedroom\w*|kitchen\w*|toilet\w*|bath\w*|garage\w*|plot\w*|land|lots?(?!\s+of)|subdivision\w*|parcel\w*|zoning|setback\w*|floor area ratio|ground coverage|permit\w*|rajuk|cda|kda|approval)\b`,
  String.raw`\b(estimat\w*|boq|bill of quantit\w*|quantit\w*|cost\w*|costing|budget\w*|rate analysis|schedule of rates|tender\w*|bid\w*|contract\w*|variation\w*|claim\w*|measurement book|invoice|material\w*|labou?r|mason\w*|workm\w*|schedul\w*|gantt|cpm|critical path|milestone\w*|progress|handover|defect\w*|crack\w*|leak\w*|damp\w*|corrosion|honeycomb\w*|repair\w*|retrofit\w*|renovat\w*|inspection\w*|safety|osha|ppe|quality control|testing|cube test|cylinder test|slump)\b`,
  String.raw`\b(bnbc|aci|aisc|asce|ibc|irc|nbc|is ?456|is ?800|is ?875|is ?1893|is ?10262|eurocode|aashto|astm|bs ?8110|rhd|lged|pwd|ubc|nds|fhwa|mepdg)\b`,
  String.raw`\b(kn|mpa|n\/mm2|psi|ksi|psf|pcf|kip\w*|cft|sft|rft|rmt|cum|sqm|sq ?ft|sq ?m|katha|bigha|decimal|shotangsho|acre\w*|hectare\w*|tonnes?)\b`,
  // Bangla
  "নির্মাণ|বাড়ি|বাড়ি|ভবন|দালান|ইট|সিমেন্ট|রড|বালি|বালু|খোয়া|পাথর|ঢালাই|কলাম|বিম|বীম|ছাদ|স্ল্যাব|ফাউন্ডেশন|ফুটিং|পাইল|মাটি|রাস্তা|সড়ক|সেতু|ব্রিজ|ড্রেন|নর্দমা|কালভার্ট|নকশা|ডিজাইন|প্ল্যান|খরচ|প্রাক্কলন|বাজেট|ইঞ্জিনিয়ার|প্রকৌশল|জমি|কাঠা|বিঘা|শতাংশ|প্লট|তলা|ফ্ল্যাট|টাইলস|রং|প্লাস্টার|দেয়াল|দেওয়াল|সিঁড়ি|জানালা|দরজা|ঠিকাদার|রাজউক|মিস্ত্রি|শ্রমিক|ফাটল|লিকেজ|স্যাঁতসেঁতে|পানি|ট্যাংক|সেপটিক|গাঁথুনি|মসলা|কংক্রিট|লোড",
].join("|"), "i");
/** Case-sensitive acronyms that are ordinary words in lower case (FAR, MS). */
const CIVIL_ACRONYMS = /\b(FAR|FSI|BOQ|RCC|PCC|DPC|MS|GI|RFI|NOC)\b/;
const civilSignal = (s: string) => CIVIL.test(s) || CIVIL_ACRONYMS.test(s);

// Maths, units and calculation words engineers use without saying "civil".
const ENG_MATH = /\b(calculat\w*|compute|formula\w*|equation\w*|convert\w*|conversion|unit\w*|area|volume|perimeter|slope|angle|radius|diameter|density|weight|mass|force|pressure|velocity|flow|discharge|interpolat\w*|excel|spreadsheet|dimension\w*|length|width|height|depth|thickness|level\w*|elevation|chainage|station\w*|bearing angle|traverse|theodolite|total station|gps|gis|drone|lidar|contour\w*)\b|\d+(\.\d+)?\s*(mm|cm|m|km|ft|in|inch|inches|feet|m2|m3|m²|m³|kg|ton|kn|mpa|psi)\b|হিসাব|মাপ|ক্ষেত্রফল|আয়তন/i;

// Requests that are clearly not engineering work. Only decisive when there is no civil signal.
const OFF_TOPIC = /\b(poem|poetry|lyrics?|song|sing|joke|story|stories about|novel|movie|film|series|netflix|anime|celebrit\w*|cricket|football|soccer|nba|nfl|match score|recipe|cook\w*|restaurant|diet|weight loss|workout|dating|girlfriend|boyfriend|love letter|horoscope|astrology|zodiac|lottery|betting|casino|crypto\w*|bitcoin|stock tips?|forex|trading signals?|politic\w*|election\w*|religio\w*|prayer times?|fatwa|medical|medicine|symptom\w*|diagnos\w*|doctor|disease|pregnan\w*|homework on|essay on|write an essay|translate this|history of (?!construction|architecture|bridges|roads)|capital of|who is the president|prime minister|game|gaming|minecraft|fortnite|pubg|free fire|hack\w*|password|instagram|facebook|tiktok|youtube video idea\w*)\b|কবিতা|গান|কৌতুক|রান্না|রেসিপি|সিনেমা|নাটক|খেলা|ক্রিকেট|রাজনীতি|নির্বাচন|প্রেম|রাশিফল/i;

const GREETING = /^\s*(hi+|hello+|hey+|hiya|yo|good (morning|afternoon|evening|night)|assalamu? ?alaikum|salam|salaam|namaste|adab|আসসালামু আলাইকুম|সালাম|হ্যালো|হাই|নমস্কার|আদাব)[\s!.,?]*$/i;
const THANKS = /^\s*(thanks?( you)?( so much| a lot)?|thank u|thx|ty|ok(ay)?( thanks?)?|great|nice|cool|got it|perfect|ধন্যবাদ|আচ্ছা|ঠিক আছে)[\s!.,]*$/i;
const META = /\b(what (can|do) you do|who are you|what is civilmate|how (do|can) i use (you|this|civilmate)|help me get started|your (capabilities|features))\b|তুমি কী করতে পারো|আপনি কী করতে পারেন/i;
/** Short replies that only make sense as a follow-up ("why?", "for 5 m", "make it M25", "explain step 2"). */
const FOLLOW_UP = /\b(this|that|these|those|it|above|previous|again|same|instead|also|then|what if|why|how|explain|detail\w*|step|more|less|increase|decrease|change|redo|recalculate|continue|go on|next|yes|no|ok|use|try|make it|and for|with|without|draw|download|excel|pdf|table|summar\w*)\b|^\s*[\d.,\s×x*/+-]+\s*\w{0,6}\s*$|আবার|কেন|কিভাবে|আরও|হ্যাঁ|না/i;

export type TopicDecision =
  | { action: "allow"; reason: "civil" | "math" | "follow_up" | "attachment" | "disabled" }
  | { action: "reply"; reason: "greeting" | "thanks" | "meta" | "off_topic"; text: string };

const lastUser = (msgs: ChatMessage[]) => [...msgs].reverse().find((m) => m.role === "user");
const textOf = (m: ChatMessage | undefined) => (m?.parts ?? []).map((p) => (p.type === "text" ? p.text : "")).join(" ").trim();

export const SCOPE_TEXT = "I'm CivilMate, an assistant for civil, structural and construction work. I can help with structural design (beams, columns, slabs, footings, steel), soil and foundations, roads and pavements, concrete mix design, quantities and BOQ, cost estimates and schedules (with Excel files), house and building planning, drawings (DXF), code clauses (BNBC, ACI, IS, AASHTO), and reading your project documents.";

export const isCivilText = civilSignal;

/**
 * Decide before any model call. `enabled` = the site's topic-guard setting.
 * Greetings, thanks and "what can you do" are answered locally even when the guard is off (they need no model).
 */
export function checkTopic(messages: ChatMessage[], enabled: boolean): TopicDecision {
  const last = lastUser(messages);
  const text = textOf(last);
  const hasAttachment = (last?.parts ?? []).some((p) => p.type === "image" || p.type === "document");
  const docText = (last?.parts ?? []).map((p) => (p.type === "document" ? p.text.slice(0, 20000) : "")).join(" ");
  const firstTurn = messages.filter((m) => m.role === "user").length <= 1;

  if (!hasAttachment && GREETING.test(text)) return { action: "reply", reason: "greeting", text: `Hello! ${SCOPE_TEXT} What are you working on?` };
  if (!hasAttachment && !firstTurn && THANKS.test(text)) return { action: "reply", reason: "thanks", text: "You're welcome. Ask any time if you need another check or calculation." };
  if (!hasAttachment && META.test(text) && !civilSignal(text.replace(META, ""))) return { action: "reply", reason: "meta", text: `${SCOPE_TEXT}\n\nTry, for example: "Design an RC beam, 5 m span, 20 kN/m live load", "Estimate cement, sand and stone for 100 cft of 1:2:4 concrete", "Plan a 3-storey house on a 5 katha plot", or attach a soil report and ask for the footing design.` };
  if (!enabled) return { action: "allow", reason: "disabled" };

  const civil = civilSignal(text) || (docText !== "" && civilSignal(docText));
  if (civil) return { action: "allow", reason: "civil" };
  const off = OFF_TOPIC.test(text);
  if (!off && ENG_MATH.test(text)) return { action: "allow", reason: "math" };
  if (!off && hasAttachment) return { action: "allow", reason: "attachment" };
  // Follow-up in a conversation that is already about civil work.
  if (!off && !firstTurn) {
    const earlier = messages.slice(0, -1).map((m) => m.parts.map((p) => (p.type === "text" ? p.text : p.type === "tool_call" ? p.name : p.type === "document" ? p.name : "")).join(" ")).join(" ");
    if (civilSignal(earlier) && (FOLLOW_UP.test(text) || text.length <= 160)) return { action: "allow", reason: "follow_up" };
  }
  return { action: "reply", reason: "off_topic", text: `Sorry, I can only help with civil, structural and construction topics, so I haven't answered this (it used none of your credits).\n\n${SCOPE_TEXT}\n\nIf your question is about a project, add a little context, for example the structure, material or site it relates to.` };
}
