// Language helpers for translations and romanization. Pure functions (no DOM), so
// they're unit-tested in Node, except translateLines() which needs Chrome.
//
//   detect(lines)    → "ja" | "ko" | "zh" | "ru" | "es" | ... | null
//   romanize(text)   → Korean (Revised Romanization, simplified), Cyrillic, Greek
//   translateLines() → Chrome's built-in, on-device Translator API

(() => {
  const SGL = (globalThis.SGL = globalThis.SGL || {});

  const SCRIPTS = [
    ["ja", /[぀-ヿ]/g], // hiragana / katakana (checked before Han)
    ["ko", /[가-힯ᄀ-ᇿ]/g],
    ["zh", /[一-鿿]/g],
    ["ru", /[Ѐ-ӿ]/g],
    ["el", /[Ͱ-Ͽ]/g],
    ["ar", /[؀-ۿ]/g],
    ["hi", /[ऀ-ॿ]/g],
    ["th", /[฀-๿]/g],
  ];

  // Frequent short words, for telling Latin-script languages apart.
  const WORDS = {
    en: "the you and i me my to it a in that is on your we be for this not no what all love so",
    es: "que de no la el y en lo me te mi tu es se por un una con como pero yo para",
    fr: "je tu de la le et les que pas des est un une ne mon ma moi toi dans pour qui",
    pt: "que de não o a e eu você me te meu minha é um uma com do da pra por",
    de: "ich du und der die das nicht ist ein eine mich dich mein dein mit zu es wir",
    it: "che di non il la e io tu mi ti è un una per con mio mia sono ma",
    nl: "ik je de het een en niet is van mijn jij we op dat zo",
    tr: "ben sen bir ve bu ne de da mi için gibi çok seni beni",
  };
  const WORD_SETS = Object.fromEntries(Object.entries(WORDS).map(([k, v]) => [k, new Set(v.split(" "))]));

  function detect(lines) {
    const text = lines.join("\n");
    if (!text.trim()) return null;
    // Japanese uses Han too, so any kana at all means Japanese.
    const counts = SCRIPTS.map(([code, re]) => [code, (text.match(re) || []).length]);
    const ja = counts.find(([c]) => c === "ja")[1];
    if (ja >= 3) return "ja";
    const [best, n] = counts.filter(([c]) => c !== "ja").sort((a, b) => b[1] - a[1])[0];
    const letters = (text.match(/\p{L}/gu) || []).length;
    if (n >= 10 && n / letters > 0.3) return best;

    const words = text.toLowerCase().match(/[\p{L}']+/gu) || [];
    const scores = Object.entries(WORD_SETS).map(([code, set]) => [code, words.filter((w) => set.has(w)).length]);
    scores.sort((a, b) => b[1] - a[1]);
    const [top, second] = scores;
    if (top[1] >= 5 && top[1] >= second[1] * 1.3) return top[0];
    return null;
  }

  // ---------- romanization ----------

  const HANGUL_L = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"];
  const HANGUL_V = ["a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i"];
  const HANGUL_T = ["", "k", "k", "k", "n", "n", "n", "t", "l", "k", "m", "l", "l", "l", "p", "l", "m", "p", "p", "t", "t", "ng", "t", "t", "k", "t", "p", "t"];

  function hangul(ch) {
    const code = ch.codePointAt(0) - 0xac00;
    if (code < 0 || code > 11171) return null;
    return HANGUL_L[Math.floor(code / 588)] + HANGUL_V[Math.floor((code % 588) / 28)] + HANGUL_T[code % 28];
  }

  const CYRILLIC = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
    н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch",
    ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya", і: "i", ї: "yi", є: "ye", ґ: "g",
  };
  const GREEK = {
    α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th", ι: "i", κ: "k", λ: "l", μ: "m", ν: "n", ξ: "x",
    ο: "o", π: "p", ρ: "r", σ: "s", ς: "s", τ: "t", υ: "y", φ: "f", χ: "ch", ψ: "ps", ω: "o",
    ά: "a", έ: "e", ή: "i", ί: "i", ό: "o", ύ: "y", ώ: "o",
  };

  function fromTable(table, ch) {
    const lower = ch.toLowerCase();
    const r = table[lower];
    if (r == null) return null;
    return ch !== lower && r ? r[0].toUpperCase() + r.slice(1) : r;
  }

  // Korean syllables are separated by spaces only where the text has them, like the original.
  function romanize(text) {
    let out = "";
    let changed = false;
    for (const ch of text) {
      const r = hangul(ch) ?? fromTable(CYRILLIC, ch) ?? fromTable(GREEK, ch);
      if (r != null) {
        out += r;
        changed = true;
      } else out += ch;
    }
    return changed ? out : null;
  }

  // Which languages romanize() handles on its own (Japanese comes from NetEase instead).
  const ROMANIZABLE = new Set(["ko", "ru", "el"]);

  // ---------- translation (Chrome's on-device Translator) ----------

  const translators = new Map(); // "ja>en" -> Promise<Translator>

  // availability: "available" | "downloadable" | "downloading" | "unavailable" | "unsupported"
  async function translatorStatus(from, to) {
    if (!("Translator" in globalThis)) return "unsupported";
    try {
      return await globalThis.Translator.availability({ sourceLanguage: from, targetLanguage: to });
    } catch {
      return "unavailable";
    }
  }

  // Must be called from a click when the model still needs downloading (Chrome's rule).
  function getTranslator(from, to, onProgress) {
    const key = `${from}>${to}`;
    if (!translators.has(key)) {
      const p = globalThis.Translator.create({
        sourceLanguage: from,
        targetLanguage: to,
        monitor(m) {
          m.addEventListener("downloadprogress", (e) => onProgress?.(e.loaded));
        },
      });
      p.catch(() => translators.delete(key));
      translators.set(key, p);
    }
    return translators.get(key);
  }

  async function translateLines(texts, from, to, onProgress) {
    const t = await getTranslator(from, to, onProgress);
    const out = [];
    for (const text of texts) out.push(text ? await t.translate(text) : "");
    return out;
  }

  SGL.lang = { detect, romanize, ROMANIZABLE, translatorStatus, translateLines };
})();
