import { UILanguage } from './types';

export interface Translation {
  appName: string;
  appTagline: string;
  searchPlaceholder: string;
  startScanning: string;
  ocrLanguage: string;
  ocrLangEngAra: string;
  ocrLangEng: string;
  ocrLangAra: string;
  matchMode: string;
  matchContains: string;
  matchExact: string;
  matchFuzzy: string;
  quickPresets: string;
  uploadTestImage: string;
  installApp: string;
  installAppBannerTitle: string;
  installAppBannerDesc: string;
  iosInstallTitle: string;
  iosStep1: string;
  iosStep2: string;
  close: string;
  cameraBack: string;
  scanning: string;
  searchingFor: string;
  matchFound: string;
  noMatches: string;
  matchesCount: string;
  engineInitializing: string;
  engineReady: string;
  torchOn: string;
  torchOff: string;
  torchNotSupported: string;
  switchCamera: string;
  takeSnapshot: string;
  snapshotTitle: string;
  downloadImage: string;
  shareImage: string;
  copyText: string;
  copied: string;
  continueScanning: string;
  detectedTextSummary: string;
  cameraPermissionDenied: string;
  cameraErrorInstructions: string;
  retryCamera: string;
  useUploadInstead: string;
  tipTitle: string;
  tip1: string;
  tip2: string;
  tip3: string;
  hapticSoundEnabled: string;
  hapticSoundDisabled: string;
  sampleImageDemo: string;
  confidence: string;
  offlineBanner: string;
  clear: string;
}

export const translations: Record<UILanguage, Translation> = {
  en: {
    appName: 'Live OCR Text Finder',
    appTagline: 'Real-time camera scanner with glowing text search overlays',
    searchPlaceholder: 'Type target word, price, code, or number...',
    startScanning: 'Start Scanning',
    ocrLanguage: 'OCR Language',
    ocrLangEngAra: 'English + Kurdish/Arabic (eng+ara)',
    ocrLangEng: 'English Only (Faster)',
    ocrLangAra: 'Arabic Only (ara)',
    matchMode: 'Match Precision',
    matchContains: 'Contains (Flexible)',
    matchExact: 'Exact Word',
    matchFuzzy: 'Fuzzy / Similar',
    quickPresets: 'Quick Presets',
    uploadTestImage: 'Test with Image / Photo',
    installApp: 'Install App',
    installAppBannerTitle: 'Install as Mobile App',
    installAppBannerDesc: 'Add to home screen for instant fullscreen camera scanning & offline support',
    iosInstallTitle: 'Install on iPhone / iPad',
    iosStep1: 'Tap the Share button in Safari toolbar at the bottom',
    iosStep2: 'Scroll down and tap "Add to Home Screen"',
    close: 'Close',
    cameraBack: 'Back',
    scanning: 'Scanning live feed...',
    searchingFor: 'Searching',
    matchFound: 'Match Found!',
    noMatches: 'Scanning... No match yet',
    matchesCount: 'matches',
    engineInitializing: 'Initializing OCR Engine...',
    engineReady: 'OCR Engine Ready',
    torchOn: 'Flashlight On',
    torchOff: 'Flashlight Off',
    torchNotSupported: 'Flashlight not supported on this lens',
    switchCamera: 'Flip Camera',
    takeSnapshot: 'Capture Highlighted Frame',
    snapshotTitle: 'Captured Snapshot',
    downloadImage: 'Download Photo',
    shareImage: 'Share',
    copyText: 'Copy Detected Text',
    copied: 'Copied to Clipboard!',
    continueScanning: 'Continue Scanning',
    detectedTextSummary: 'Extracted Text in Frame',
    cameraPermissionDenied: 'Camera Access Needed',
    cameraErrorInstructions: 'Please allow camera permission in your browser settings to scan text in real-time.',
    retryCamera: 'Retry Camera Access',
    useUploadInstead: 'Or Upload / Pick a Photo',
    tipTitle: 'Pro Tips for Sharp OCR',
    tip1: 'Keep the camera steady and perpendicular to the text.',
    tip2: 'Use the built-in flashlight toggle in dim lighting.',
    tip3: 'Works on receipts, documents, street signs, boxes, and screens.',
    hapticSoundEnabled: 'Audio/Haptic Alert ON',
    hapticSoundDisabled: 'Alerts Muted',
    sampleImageDemo: 'Try Sample Document',
    confidence: 'Conf',
    offlineBanner: 'Offline Mode active. Cached model and scanner ready.',
    clear: 'Clear',
  },
  ku: {
    appName: 'گەڕانی دەقی ڕاستەوخۆ',
    appTagline: 'سکێنەری کامێرا بەشێوەی ڕاستەوخۆ بە دیاریکردنی ڕووناکی دەق',
    searchPlaceholder: 'وشە، ژمارە، نرخ یان کۆد بنووسە بۆ دۆزینەوە...',
    startScanning: 'دەستپێکردنی گەڕان',
    ocrLanguage: 'زمانی خوێندنەوە (OCR)',
    ocrLangEngAra: 'ئینگلیزی + کوردی/عەرەبی (eng+ara)',
    ocrLangEng: 'تەنها ئینگلیزی (خێراتر)',
    ocrLangAra: 'تەنها عەرەبی (ara)',
    matchMode: 'شێوازی دۆزینەوە',
    matchContains: 'لەخۆگرتن (نەرم)',
    matchExact: 'تەواو هەمان وشە',
    matchFuzzy: 'نزیک لە وشەکە',
    quickPresets: 'وشە باوەکان',
    uploadTestImage: 'تاقیکردنەوە بە وێنە',
    installApp: 'دابەزاندنی ئەپ',
    installAppBannerTitle: 'دابەزاندن وەک ئەپی مۆبایل',
    installAppBannerDesc: 'زیادی بکە بۆ سەر شاشەی سەرەکی بۆ خێرایی و کارکردنی بێ ئینتەرنێت',
    iosInstallTitle: 'دابەزاندن بۆ ئایفۆن / ئایپاد',
    iosStep1: 'لە سەفاری داگرە لەسەر دوگمەی Share (هاوبەشکردن)',
    iosStep2: 'بڕۆ خوارەوە و داگرە لەسەر "Add to Home Screen"',
    close: 'داخستن',
    cameraBack: 'گەڕانەوە',
    scanning: 'گەڕان لە کامێرادا...',
    searchingFor: 'گەڕان بۆ',
    matchFound: 'دۆزرایەوە!',
    noMatches: 'دەگەڕێت... هێشتا نەدۆزراوەتەوە',
    matchesCount: 'دۆزراوە',
    engineInitializing: 'ئامادەکردنی مەکینەی ناسینەوە...',
    engineReady: 'سیستەم ئامادەیە',
    torchOn: 'فلاش کارا کرا',
    torchOff: 'فلاش کوژایەوە',
    torchNotSupported: 'فلاش لەسەر ئەم کامێرایە بەردەست نییە',
    switchCamera: 'گۆڕینی کامێرا',
    takeSnapshot: 'گرتنی وێنە بە دەقی دیاریکراوەوە',
    snapshotTitle: 'وێنەی گیراو',
    downloadImage: 'داگرتنی وێنە',
    shareImage: 'هاوبەشکردن',
    copyText: 'کۆپیکردنی دەقەکان',
    copied: 'کۆپی کرا!',
    continueScanning: 'بەردەوامبوون لە گەڕان',
    detectedTextSummary: 'دەقە ناسراوەکانی ناو وێنەکە',
    cameraPermissionDenied: 'پێویستی بە ڕێگەپێدانی کامێرا هەیە',
    cameraErrorInstructions: 'تکایە لە ڕێکخستنەکانی وێبگەڕەکەتدا ڕێگە بدە بە کامێرا تا بتوانیت دەقەکان بخوێنیتەوە.',
    retryCamera: 'دووبارە هەوڵدانەوەی کامێرا',
    useUploadInstead: 'یان وێنەیەک هەڵبژێرە',
    tipTitle: 'ئامۆژگاری بۆ ئەنجامی باشتر',
    tip1: 'کامێراکە ڕاست و بێ لەرزین بەرامبەر دەقەکە بگرە.',
    tip2: 'لە شوێنی تاریکدا دوگمەی فلاش دابگرە.',
    tip3: 'لەسەر وەسڵ، پەڕاو، تابلۆ و شاشەکان کار دەکات.',
    hapticSoundEnabled: 'لەرین و دەنگ کارایە',
    hapticSoundDisabled: 'بێدەنگ کرا',
    sampleImageDemo: 'نموونەی دۆکیومێنت',
    confidence: 'ڕێژە',
    offlineBanner: 'دۆخی بێ ئینتەرنێت کارایە. سیستەم ئۆفلاین کار دەکات.',
    clear: 'سڕینەوە',
  },
  ar: {
    appName: 'الباحث عن النص المباشر',
    appTagline: 'مسح كاميرا فوري مع تحديد وإضاءة الكلمات المطابقة',
    searchPlaceholder: 'اكتب الكلمة أو الرقم أو السعر للبحث عنه...',
    startScanning: 'بدء المسح',
    ocrLanguage: 'لغة القراءة (OCR)',
    ocrLangEngAra: 'إنجليزي + عربي/كردي (eng+ara)',
    ocrLangEng: 'إنجليزي فقط (أسرع)',
    ocrLangAra: 'عربي فقط (ara)',
    matchMode: 'دقة المطابقة',
    matchContains: 'يحتوي على (مرن)',
    matchExact: 'مطابقة تامة',
    matchFuzzy: 'تقريبي / مشابه',
    quickPresets: 'كلمات شائعة',
    uploadTestImage: 'تجربة صورة من الجهاز',
    installApp: 'تثبيت التطبيق',
    installAppBannerTitle: 'تثبيت كتطبيق هاتف',
    installAppBannerDesc: 'أضفه للشاشة الرئيسية للتشغيل الفوري بكامل الشاشة وبدون إنترنت',
    iosInstallTitle: 'التثبيت على آيفون / آيباد',
    iosStep1: 'اضغط على زر المشاركة (Share) في أسفل متصفح سفاري',
    iosStep2: 'مرر لأسفل واضغط على "إضافة إلى الشاشة الرئيسية" (Add to Home Screen)',
    close: 'إغلاق',
    cameraBack: 'رجوع',
    scanning: 'جاري المسح المباشر...',
    searchingFor: 'البحث عن',
    matchFound: 'تم العثور على تطابق!',
    noMatches: 'جاري البحث... لم يتم العثور بعد',
    matchesCount: 'تطابقات',
    engineInitializing: 'جاري تجهيز محرك القراءة...',
    engineReady: 'المحرك جاهز',
    torchOn: 'تشغيل الفلاش',
    torchOff: 'إيقاف الفلاش',
    torchNotSupported: 'الفلاش غير مدعوم على هذه الكاميرا',
    switchCamera: 'تبديل الكاميرا',
    takeSnapshot: 'التقاط الصورة مع التحديد',
    snapshotTitle: 'الصورة الملتقطة',
    downloadImage: 'حفظ الصورة',
    shareImage: 'مشاركة',
    copyText: 'نسخ النص المكتشف',
    copied: 'تم النسخ للحافظة!',
    continueScanning: 'متابعة المسح',
    detectedTextSummary: 'النصوص المكتشفة في الإطار',
    cameraPermissionDenied: 'مطلوب إذن الكاميرا',
    cameraErrorInstructions: 'يرجى السماح بالوصول للكاميرا من إعدادات المتصفح لمسح النصوص.',
    retryCamera: 'إعادة محاولة فتح الكاميرا',
    useUploadInstead: 'أو اختر صورة من جهازك',
    tipTitle: 'نصائح لدقة أعلى',
    tip1: 'ثبّت الكاميرا بشكل مستقيم أمام النص.',
    tip2: 'استخدم الفلاش المدمج في الإضاءة الخافتة.',
    tip3: 'يعمل على الفواتير، المستندات، اللوحات، والشاشات.',
    hapticSoundEnabled: 'التنبيه والاهتزاز مفعل',
    hapticSoundDisabled: 'كتم التنبيهات',
    sampleImageDemo: 'تجربة مستند تجريبي',
    confidence: 'الدقة',
    offlineBanner: 'وضع عدم الاتصال مفعل. النموذج يعمل محلياً.',
    clear: 'مسح',
  },
};

export const PRESETS_BY_LANG: Record<UILanguage, string[]> = {
  en: ['Total', 'Price', 'Expiry', 'Password', 'Invoice', 'Serial', 'Tax', 'Date'],
  ku: ['کۆی گشتی', 'نرخ', 'بەسەرچوون', 'تێپەڕەوشە', 'پسوولە', 'بەروار', 'Total', 'Code'],
  ar: ['المجموع', 'السعر', 'تاريخ الانتهاء', 'كلمة المرور', 'فاتورة', 'الرقم التسلسلي', 'Total', 'PIN'],
};
