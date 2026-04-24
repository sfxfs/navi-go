import type { ZodType } from "zod";

const zeroWidthChars = /[\u200B-\u200D\uFEFF\u2060\u180E]/g;
const homoglyphMap: Record<string, string> = {
  "𝟎": "0", "𝟘": "0", "𝟢": "0", "𝟬": "0", "𝟶": "0",
  "𝟏": "1", "𝟙": "1", "𝟣": "1", "𝟭": "1", "𝟷": "1",
  "𝟐": "2", "𝟚": "2", "𝟤": "2", "𝟮": "2", "𝟸": "2",
  "𝟑": "3", "𝟛": "3", "𝟥": "3", "𝟯": "3", "𝟹": "3",
  "𝟒": "4", "𝟜": "4", "𝟦": "4", "𝟰": "4", "𝟺": "4",
  "𝟓": "5", "𝟝": "5", "𝟧": "5", "𝟱": "5", "𝟻": "5",
  "𝟔": "6", "𝟞": "6", "𝟨": "6", "𝟲": "6", "𝟼": "6",
  "𝟕": "7", "𝟟": "7", "𝟩": "7", "𝟳": "7", "𝟽": "7",
  "𝟖": "8", "𝟠": "8", "𝟪": "8", "𝟴": "8", "𝟾": "8",
  "𝟗": "9", "𝟡": "9", "𝟫": "9", "𝟵": "9", "𝟿": "9",
  "𝗮": "a", "𝘢": "a", "𝒂": "a", "𝓪": "a", "𝔞": "a", "𝖆": "a",
  "𝗯": "b", "𝘣": "b", "𝒃": "b", "𝓫": "b", "𝔟": "b", "𝖇": "b",
  "𝗰": "c", "𝘤": "c", "𝒄": "c", "𝓬": "c", "𝔠": "c", "𝖈": "c",
  "𝗱": "d", "𝘥": "d", "𝒅": "d", "𝓭": "d", "𝔡": "d", "𝖉": "d",
  "𝗲": "e", "𝘦": "e", "𝒆": "e", "𝓮": "e", "𝔢": "e", "𝖊": "e",
  "𝗳": "f", "𝘧": "f", "𝒇": "f", "𝓯": "f", "𝔣": "f", "𝖋": "f",
  "𝗴": "g", "𝘨": "g", "𝒈": "g", "𝓰": "g", "𝔤": "g", "𝖌": "g",
  "𝗵": "h", "𝘩": "h", "𝒉": "h", "𝓱": "h", "𝔥": "h", "𝖍": "h",
  "𝗶": "i", "𝘪": "i", "𝒊": "i", "𝓲": "i", "𝔦": "i", "𝖎": "i",
  "𝗷": "j", "𝘫": "j", "𝒋": "j", "𝓳": "j", "𝔧": "j", "𝖏": "j",
  "𝗸": "k", "𝘬": "k", "𝒌": "k", "𝓴": "k", "𝔨": "k", "𝖐": "k",
  "𝗹": "l", "𝘭": "l", "𝒍": "l", "𝓵": "l", "𝔩": "l", "𝖑": "l",
  "𝗺": "m", "𝘮": "m", "𝒎": "m", "𝓶": "m", "𝔪": "m", "𝖒": "m",
  "𝗻": "n", "𝘯": "n", "𝒏": "n", "𝓷": "n", "𝔫": "n", "𝖓": "n",
  "𝗼": "o", "𝘰": "o", "𝒐": "o", "𝓸": "o", "𝔬": "o", "𝖔": "o",
  "𝗽": "p", "𝘱": "p", "𝒑": "p", "𝓹": "p", "𝔭": "p", "𝖕": "p",
  "𝗾": "q", "𝘲": "q", "𝒒": "q", "𝓺": "q", "𝔮": "q", "𝖖": "q",
  "𝗿": "r", "𝘳": "r", "𝒓": "r", "𝓻": "r", "𝔯": "r", "𝖗": "r",
  "𝘀": "s", "𝘴": "s", "𝒔": "s", "𝓼": "s", "𝔰": "s", "𝖘": "s",
  "𝘁": "t", "𝘵": "t", "𝒕": "t", "𝓽": "t", "𝔱": "t", "𝖙": "t",
  "𝘂": "u", "𝘶": "u", "𝒖": "u", "𝓾": "u", "𝔲": "u", "𝖚": "u",
  "𝘃": "v", "𝘷": "v", "𝒗": "v", "𝓿": "v", "𝔳": "v", "𝖛": "v",
  "𝘄": "w", "𝘸": "w", "𝒘": "w", "𝔀": "w", "𝔴": "w", "𝖜": "w",
  "𝘅": "x", "𝘹": "x", "𝒙": "x", "𝔁": "x", "𝔵": "x", "𝖝": "x",
  "𝘆": "y", "𝘺": "y", "𝒚": "y", "𝔂": "y", "𝔶": "y", "𝖞": "y",
  "𝘇": "z", "𝘻": "z", "𝒛": "z", "𝔃": "z", "𝔷": "z", "𝖟": "z",
};

const normalizeForScan = (input: string): string => {
  let cleaned = input.replace(zeroWidthChars, "");
  cleaned = cleaned
    .split("")
    .map((ch) => homoglyphMap[ch] ?? ch)
    .join("");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned;
};

const injectionPatterns: RegExp[] = [
  /ignore (all |previous |prior |earlier )?instructions?/i,
  /reveal (the )?(system |developer |hidden |inner )?prompt/i,
  /bypass (safety|guard|policy|restrictions|filters)/i,
  /act as .* without restrictions/i,
  /disable (security|guardrails?|filters|safeguards)/i,
  /new instructions?[:：]/i,
  /replace (all |previous |prior |earlier )?instructions?/i,
  /forget (all |previous |prior |earlier )?instructions?/i,
  /you are (now |from now on )?(an? )?(unrestricted|uncensored|developer mode)/i,
  /DAN mode/i,
  /jailbreak/i,
];

const unsafeOutputPatterns: RegExp[] = [
  /how to (build|make|create|manufacture) (a )?(bomb|weapon|explosive|firearm)/i,
  /illegal (trafficking|trade|smuggling)/i,
  /evade (law enforcement|police|authorities|taxes)/i,
  /self[- ]?harm instructions?/i,
  /suicide (methods?|guide|instructions?)/i,
  /child (exploitation|abuse|pornography)/i,
];

export const detectPromptInjection = (input: string): string[] => {
  const normalized = normalizeForScan(input);
  return injectionPatterns
    .filter((pattern) => pattern.test(normalized))
    .map((pattern) => `PROMPT_INJECTION:${pattern.source}`);
};

export const detectUnsafeOutput = (output: string): string[] => {
  return unsafeOutputPatterns
    .filter((pattern) => pattern.test(output))
    .map((pattern) => `UNSAFE_OUTPUT:${pattern.source}`);
};

export const validateWithSchema = <T>(schema: ZodType<T>, value: unknown): T => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Schema validation failed: ${parsed.error.message}`);
  }

  return parsed.data;
};
