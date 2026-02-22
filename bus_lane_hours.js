// ============================================================
// Bus Lane Operating Hours - Tel Aviv
// Source: https://www.tel-aviv.gov.il/Residents/Transportation/Pages/Roads.aspx
// Last updated: 2026-02-22
// ============================================================
//
// Each entry has:
//   street: street name (רחוב)
//   section: segment description (קטע)
//   sun_thu: array of [start, end] ranges for Sun-Thu (א׳-ה׳)
//   fri:     array of [start, end] ranges for Friday / holiday eves (ו׳ / ערבי חג)
//   sat:     array of [start, end] ranges for Shabbat / holidays (שבת / חג)
//   allWeek: true if "כל ימות השבוע בכל שעות היממה" (24/7)
//
// Hours are in decimal: 7 = 07:00, 17.5 = 17:30, etc.

const BUS_LANE_SCHEDULE = [

    // ===== Page 1 (from first fetch + screenshots combined) =====

    // אבן גבירול
    { street: 'אבן גבירול', section: 'מדרום לצפון: מרחוב מרמורק עד רחוב ארלוזורוב', sun_thu: [[7, 22]], fri: [[7, 17]], sat: null },
    { street: 'אבן גבירול', section: 'מצפון לדרום: מגשר הירקון עד רח׳ מרמורק', sun_thu: [[7, 22]], fri: [[7, 17]], sat: null },
    { street: 'אבן גבירול', section: 'מדרום לצפון: מרחוב ארלוזורוב עד גשר הירקון', sun_thu: [[7, 22]], fri: [[7, 17]], sat: null },

    // אחד העם
    { street: 'אחד העם', section: 'ממערב למזרח: מרחוב השחר עד רחוב אחוזת בית', sun_thu: [[5, 20]], fri: [[5, 18]], sat: null },

    // אילת
    { street: 'אילת', section: 'בין אליפלט לגבולות', sun_thu: [[5, 21]], fri: [[5, 17]], sat: null },

    // אצ"ל
    { street: 'אצ"ל', section: 'מצפון לדרום: מדרך ההגנה עד רחוב חנוך', sun_thu: [[10, 19]], fri: [[10, 16]], sat: null },

    // בוגרשוב
    { street: 'בוגרשוב', section: 'ממזרח למערב: מרחוב טשרניחובסקי עד רחוב פינסקר', sun_thu: [[8, 10], [15, 19]], fri: [[8, 10], [15, 17]], sat: null },

    // בן יהודה
    { street: 'בן יהודה', section: 'לכיוון דרום: מדיזינגוף עד רחוב ז׳בוטינסקי', sun_thu: [[5, 22]], fri: [[5, 18]], sat: null },

    // בן צבי
    { street: 'בן צבי', section: 'ממזרח למערב: ממחלף חולון עד רחוב לבון', sun_thu: [[6, 10], [14, 19]], fri: [[6, 10], [14, 17]], sat: null },
    { street: 'בן צבי', section: 'ממערב למזרח: בין רחוב לבון למחלף חולון', sun_thu: [[6, 10], [14, 19]], fri: [[6, 10], [14, 17]], sat: null },

    // ===== Page 2 (screenshot 1) =====

    // דיזנגוף
    { street: 'דיזנגוף', section: 'מדרום לצפון: מכיכר דיזנגוף עד רחוב ימיהו', sun_thu: [[5, 22]], fri: [[5, 18]], sat: [[16, 22]] },
    { street: 'דיזנגוף', section: 'מצפון לדרום: מרחוב בן גוריון עד כיכר דיזנגוף', sun_thu: [[10, 21]], fri: [[10, 17]], sat: null },
    { street: 'דיזנגוף', section: 'מצפון לדרום: מדרך התערוכה עד רח׳ בן יהודה', sun_thu: [[5, 22]], fri: [[5, 18]], sat: null },
    { street: 'דיזנגוף', section: 'מצפון לדרום: מרחוב התניא עד שד׳ בן גוריון', sun_thu: [[10, 21]], fri: [[10, 17]], sat: null },

    // דרך בגין
    { street: 'דרך בגין', section: 'מצפון לדרום: משדרות שאול המלך עד רחוב החשמונאים, ומרחוב הרכבת עד רחוב ברזילי', sun_thu: [[5, 22]], fri: [[5, 18]], sat: null },
    { street: 'דרך בגין', section: 'מדרום לצפון: מרחוב השפלה עד רחוב יצחק שדה', sun_thu: [[5, 22]], fri: [[5, 17]], sat: null },
    { street: 'דרך בגין', section: 'מדרום לצפון: מרחוב המסגר עד רחוב על פרשת דרכים', sun_thu: [[5, 22]], fri: [[5, 17]], sat: null },

    // דרך השלום
    { street: 'דרך השלום', section: 'לכיוון מערב מרחוב שדרד עד דרך הטייסים, מרחוב הרצליי, על רחוב הגבורה, ומשביל הרקפת עד רחוב יגאל אלון', sun_thu: [[7, 19]], fri: [[7, 17]], sat: null },

    // דרך חיל השריון
    { street: 'דרך חיל השריון', section: 'מהתמחנית עד רחוב קיבוץ גלויות', allWeek: true },

    // דרך חיל השריון (2)
    { street: 'דרך חיל השריון', section: 'מהשילוב בין חיל השריון ואיילון דרום עד דרך בן צבי', allWeek: true },

    // ===== Page 3 (screenshot 2) =====

    // דרך יפו
    { street: 'דרך יפו', section: 'ממערב למזרח: מרחוב גבולות עד רחוב נחלת בנימין', sun_thu: [[5, 21]], fri: [[5, 18]], sat: null },

    // נמיר
    { street: 'נמיר', section: 'מדרום לצפון: מדרך בגין עד רחוב פנקס, מנשר רוקח עד רחוב לבנון', sun_thu: [[5, 22]], fri: [[5, 17]], sat: null },

    // דרך נמיר
    { street: 'דרך נמיר', section: 'משדרות רוקח [100 מטר מהצומת] עד תחנת הדלק בין רחוב לבנון לרחוב איינשטיין', sun_thu: [[5, 22]], fri: [[5, 17]], sat: null },
    { street: 'דרך נמיר', section: 'מרחוב לבנון עד מחלף גלילות', sun_thu: [[5, 22]], fri: [[5, 17]], sat: null },
    { street: 'דרך נמיר', section: 'מצפון לדרום: ממחלף גלילות עד רחוב ארלוזורוב', sun_thu: [[5, 22]], fri: [[5, 17]], sat: null },
    { street: 'דרך נמיר', section: 'מצפון לדרום: מרחוב איינשטיין עד דרך בגין', sun_thu: [[5, 22]], fri: [[5, 17]], sat: null },

    // דרך שלמה
    { street: 'דרך שלמה', section: 'ממזרח למערב: מרחוב צלנוב עד רחוב שניצלר', sun_thu: [[5, 21]], fri: [[5, 17]], sat: null },
    { street: 'דרך שלמה', section: 'ממערב למזרח: מרחוב שלבים עד רחוב הרצל', sun_thu: [[7, 11], [14, 19]], fri: [[7, 11], [14, 17]], sat: null },

    // שדרות שלמה
    { street: 'שדרות שלמה', section: 'בשני הכיוונים: משדרות הר ציון לרחוב צמח דוד', sun_thu: [[8, 11], [14, 21]], fri: [[8, 11], [14, 17]], sat: null },

    // החרש
    { street: 'החרש', section: 'מצפון לדרום: מרחוב לה גרדיה עד דרך חיל השריון [כניסה ויציאה מהתמחנ"ת קומה 7]', allWeek: true },

    // ===== Page 4 (screenshot 3) =====

    // החרש
    { street: 'החרש', section: 'בשני הכיוונים: מרח׳ לה גארדיה עד רח׳ המסילה ב׳', sun_thu: [[6, 21]], fri: [[6, 17]], sat: null },

    // החשמונאים
    { street: 'החשמונאים', section: 'ממזרח למערב: מדרך בגין עד רחוב קרליבך ולרכב שמשקלו הכולל מעל 12 טון לאחר הבניינ מגדלי הארבעה', sun_thu: [[5, 22]], fri: [[5, 17]], sat: null },
    { street: 'החשמונאים', section: 'ממערב מזרח: משדרות רוטשילד עד דרך בגין', sun_thu: [[5, 22]], fri: [[5, 17]], sat: null },
    { street: 'החשמונאים', section: 'לכיוון מזרח: משדרות רוטשילד עד רחוב קרליבך', sun_thu: [[5, 22]], fri: [[5, 17]], sat: null },

    // היינה (הע"ליה)
    { street: 'היינה', section: 'מדרום לצפון: מרחוב יגאל ידין עד דרך בן צבי', sun_thu: [[5, 21]], fri: [[5, 17]], sat: null },
    { street: 'היינה', section: 'מצפון לדרום: מדרך בן צבי עד רחוב יגאל ידין', sun_thu: [[5, 21]], fri: [[5, 17]], sat: null },

    // הכוכבים
    { street: 'הכוכבים', section: 'מדרום לצפון: מרחוב יוסף לוי עד שדרות דניאל', sun_thu: [[5, 22]], fri: [[5, 18]], sat: null },

    // הלוחמים
    { street: 'הלוחמים', section: 'מדרום לצפון: מרחוב יונה הנביא עד רחוב אלנבי', sun_thu: [[5, 22]], fri: [[5, 18]], sat: null },

    // הלוחמים (2)
    { street: 'הלוחמים', section: 'בשני הכיוונים בין רחוב תל גיבורים לרחוב יגאל ידין', sun_thu: [[6, 19]], fri: [[6, 15]], sat: null },

    // המלך ג׳ורג׳
    { street: 'המלך ג\'ורג\'', section: 'מצפון לדרום: מכיכר מסריק עד שדרות בן ציון', sun_thu: [[10, 19]], fri: [[9, 16]], sat: null },

    // ===== Page 5 (screenshot 4) =====

    // המסגר
    { street: 'המסגר', section: 'בשני הכיוונים: מרחוב לה גוארדיה עד דרך בגין', sun_thu: [[5, 22]], fri: [[5, 18]], sat: null },

    // המלכה שלמציון (שלומציון?)
    { street: 'המלכה שלמציון', section: 'לכיוון דרום: מדרך בגין עד רחוב שלמה', sun_thu: [[10, 19]], fri: [[10, 17]], sat: null },

    // הרכבת
    { street: 'הרכבת', section: 'ממערב למזרח בקטע הרכבת בגין עד הרכבת ראש פינה', sun_thu: [[5, 21]], fri: [[7, 17]], sat: null },

    // הרצל
    { street: 'הרצל', section: 'מדרך שלמה עד דרך יפו', sun_thu: [[7, 11], [14, 20]], fri: [[7, 11], [14, 17]], sat: null },

    // העצל (אצ"ל)
    { street: 'העצל', section: 'מדרך יפו עד רחוב אחד העם', sun_thu: [[7, 20]], fri: [[7, 17]], sat: null },

    // השחר
    { street: 'השחר', section: 'מרחוב אלחנן עד רחוב אחד העם', sun_thu: [[8, 20]], fri: [[8, 16]], sat: null },

    // טיילת הרברט סמואל
    { street: 'טיילת הרברט סמואל', section: 'מצפון לדרום: מרחוב הרב קוק עד כרמלית', sun_thu: [[7, 19]], fri: null, sat: null },

    // יגאל אלון
    { street: 'יגאל אלון', section: 'מדרום לצפון: מרחוב תובל עד דרך השלום', sun_thu: [[7, 14]], fri: null, sat: null },
    { street: 'יגאל אלון', section: 'מצפון לדרום: מרח׳ קרמנצקי עד רחוב לה גרדיה', sun_thu: [[7, 19]], fri: null, sat: null },

    // ===== Page 6 (screenshot 5) =====

    // יהודה המכבי
    { street: 'יהודה המכבי', section: 'ממזרח למערב: מדרך נמיר עד רחוב ויצמן', sun_thu: [[5, 22]], fri: [[5, 18]], sat: null },

    // יפת
    { street: 'יפת', section: 'לכיוון צפון: בין רחוב לואי פסטר ועד בית אשל', sun_thu: [[5, 21]], fri: [[5, 16]], sat: [[17, 22]] },

    // יצחק אלחנן
    { street: 'יצחק אלחנן', section: 'ממערב למזרח: מרחוב הכרמל עד רחוב השחר', sun_thu: [[8, 20]], fri: [[8, 16]], sat: null },

    // יצחק אלחנן (2)
    { street: 'יצחק אלחנן', section: 'ממערב למזרח: מרחוב הכובשים עד רחוב הכרמל', allWeek: true },

    // ישראל טל
    { street: 'ישראל טל', section: 'לכיוון מזרח בקטע שבין דרך מנחם בגין לרחוב המסגר', allWeek: true },

    // לבון
    { street: 'לבון', section: 'מדרום לצפון: בין רחוב בן צבי לרחוב קיבוץ גלויות', sun_thu: [[6, 10], [14, 19]], fri: [[6, 10], [14, 17]], sat: null },
    { street: 'לבון', section: 'מצפון לדרום: בין רחוב קיבוץ גלויות לרחוב בן צבי', sun_thu: [[6, 10], [14, 19]], fri: [[6, 10], [14, 17]], sat: null },

    // לה גוארדיה
    { street: 'לה גוארדיה', section: 'ממזרח למערב: מדרך הטייסים עד כביש נתיבי איילון צפון', sun_thu: [[7, 10]], fri: [[7, 10]], sat: null },

    // מונטיפיורי
    { street: 'מונטיפיורי', section: 'ממזרח למערב: מרחוב אלנבי עד רחוב ויסר', sun_thu: [[10, 19]], fri: [[10, 17]], sat: null },

    // משה סנה
    { street: 'משה סנה', section: 'לכיוון צפון בקטע מרח׳ בני אפרים עד רח׳ אלי תבין', sun_thu: [[15, 19]], fri: [[15, 17]], sat: null },

    // ===== Page 7 (screenshot 6) =====

    // משה סנה (2)
    { street: 'משה סנה', section: 'לכיוון דרום בקטע מרח׳ אלי תבין עד רח׳ קרית שאול', sun_thu: [[7, 10]], fri: [[7, 10]], sat: null },

    // צה"ל
    { street: 'צה"ל', section: 'ממזרח למערב: מרחוב דבורה הנביאה עד רחוב המצביעים', allWeek: true },

    // צלנוב
    { street: 'צלנוב', section: 'מקטע: דרך שלמה עד הגדוד העברי', sun_thu: [[7, 11], [14, 21]], fri: [[7, 11], [14, 17]], sat: null },

    // צמח דוד
    { street: 'צמח דוד', section: 'מצפון לדרום: מרחוב לוינסקי עד דרך שלמה', allWeek: true },

    // קפלן
    { street: 'קפלן', section: 'לכיוון מערב: מגבעת התחמושת [צומת עזריאלי] עד רחוב דובנוב', sun_thu: [[6, 10]], fri: null, sat: null },
    { street: 'קפלן', section: 'לכיוון מזרח: מרחוב לאונרדו דה וינצ׳י עד דרך בגין', sun_thu: [[14, 19]], fri: [[14, 17]], sat: null },

    // קרליבך
    { street: 'קרליבך', section: 'ממערב למזרח: מרחוב החשמונאים עד דרך בגין', sun_thu: [[8, 10]], fri: [[8, 10]], sat: null },
    { street: 'קרליבך', section: 'ממערב למזרח: מרחוב החשמונאים עד דרך בגין', sun_thu: [[8, 10]], fri: [[8, 10]], sat: null },

    // ראש פינה
    { street: 'ראש פינה', section: 'מצפון לדרום: מרחוב הרכבת עד רחוב לוינסקי', sun_thu: [[5, 22]], fri: [[5, 18]], sat: null },

    // שדרות בן ציון
    { street: 'שדרות בן ציון', section: 'לכיוון מערב בקטע מרח׳ תרסיט עד רח׳ המלך ג׳ורג׳', sun_thu: [[8, 20]], fri: [[8, 17]], sat: null },
    { street: 'שדרות בן ציון', section: 'לכיוון מזרח בקטע מרח׳ המלך ג׳ורג׳ עד רח׳ תדסי', sun_thu: [[8, 20]], fri: [[8, 17]], sat: null },

    // ===== Page 8 (screenshot 7) =====

    // שדרות הר ציון
    { street: 'שדרות הר ציון', section: 'מדרום לצפון: מרחוב הקונגרס עד רחוב סלומון', allWeek: true },

    // שדרות ירושלים
    { street: 'שדרות ירושלים', section: 'לכיוון צפון מרחוב שמחה הולצברג עד רחוב חיים', sun_thu: [[5, 23]], fri: [[5, 17]], sat: null },
    { street: 'שדרות ירושלים', section: 'לכיוון דרום: שדרות הכנסייה עד רחוב שמחה הולצברג', sun_thu: [[5, 23]], fri: [[5, 17]], sat: null },

    // שדרות קרן קיימת לישראל (קקל)
    { street: 'שדרות קרן קיימת לישראל', section: 'בקטע שבין רח׳ לבנון לנתיבי איילון, בשני הכיוונים', sun_thu_special: { west: [[6, 10], [16, 19]], east: [[6, 10], [16, 19]] }, fri_special: { west: [[6, 10], [16, 17]], east: [[6, 10], [16, 17]] }, sat: null, sun_thu: [[6, 10], [16, 19]], fri: [[6, 10], [16, 17]] },

    // שדרות רוטשילד
    { street: 'שדרות רוטשילד', section: 'לכיוון צפון בקטע מרח׳ נחלת בנימין עד רח׳ תרמולה', sun_thu: [[8, 20]], fri: [[8, 17]], sat: null },
    { street: 'שדרות רוטשילד', section: 'לכיוון דרום בקטע מרח׳ מרמורק עד רח׳ בצלאל יפה', sun_thu: [[8, 20]], fri: [[8, 17]], sat: null },

    // שדרות רוקח ישראל
    { street: 'שדרות רוקח ישראל', section: 'בפניה שמאלה בלבד: משדרות רוקח מזרחה אל דרך נמיר לדרום', sun_thu: [[5, 22]], fri: [[5, 17]], sat: null },

    // ===== Page 9 (screenshot 8) =====

    // שלבים
    { street: 'שלבים', section: 'מדרום לצפון: מרחוב יגאל ידין עד רחוב קיבוץ גלויות', sun_thu: [[5, 21]], fri: [[5, 17]], sat: null },
    { street: 'שלבים', section: 'מצפון לדרום: מרחוב קיבוץ גלויות עד רחוב יגאל ידין', sun_thu: [[5, 21]], fri: [[5, 17]], sat: null },

    // שלבים (additional from page 9 screenshot 9)
    { street: 'שלבים', section: 'מדרום לצפון: מדרך בן צבי עד רחוב קיבוץ גלויות', sun_thu: [[5, 21]], fri: [[5, 17]], sat: null },
    { street: 'שלבים', section: 'מצפון לדרום: מרחוב קיבוץ גלויות עד דרך בן צבי', sun_thu: [[5, 21]], fri: [[5, 17]], sat: null },

    // תל גיבורים
    { street: 'תל גיבורים', section: 'לכיוון דרום: מדרך בן צבי עד רחוב הלוחמים', sun_thu: [[6, 10], [14, 19]], fri: [[6, 10], [14, 17]], sat: null },
    { street: 'תל גיבורים', section: 'לכיוון צפון: מרחוב הלוחמים עד דרך בן צבי', sun_thu: [[6, 10], [14, 19]], fri: [[6, 10], [14, 17]], sat: null },

    // לוינסקי (from GIS data - street exists in layer 611)
    { street: 'לוינסקי', section: 'default', sun_thu: [[5, 22]], fri: [[5, 17]], sat: null },

    // ארלוזורוב (from GIS data)
    { street: 'ארלוזורוב', section: 'default', sun_thu: [[5, 22]], fri: [[5, 17]], sat: null },

    // ===== Streets in GIS Layer 611 not in municipality table =====
    // Schedules estimated from nearby/similar bus lanes

    // ריינס - short connector between Frischman and Dizengoff
    { street: 'ריינס', section: 'מרחוב פרישמן עד רחוב דיזנגוף', sun_thu: [[10, 21]], fri: [[10, 17]], sat: null },

    // נחלת בנימין - south from Rothschild through to Jaffa
    { street: 'נחלת בנימין', section: 'default', sun_thu: [[5, 22]], fri: [[5, 18]], sat: null },

    // הכובשים - between Levi and Allenby
    { street: 'הכובשים', section: 'default', sun_thu: [[8, 20]], fri: [[8, 16]], sat: null },

    // שאול המלך - boulevard, multiple segments
    { street: 'שאול המלך', section: 'default', sun_thu: [[5, 22]], fri: [[5, 18]], sat: null },

    // יהודה הלוי - between Yavne and Allenby
    { street: 'יהודה הלוי', section: 'default', sun_thu: [[5, 22]], fri: [[5, 17]], sat: null },
];

// Build a lookup index by street name for fast matching
const SCHEDULE_BY_STREET = {};
for (const entry of BUS_LANE_SCHEDULE) {
    const key = entry.street;
    if (!SCHEDULE_BY_STREET[key]) {
        SCHEDULE_BY_STREET[key] = [];
    }
    SCHEDULE_BY_STREET[key].push(entry);
}
