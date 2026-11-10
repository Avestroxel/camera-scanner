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

  // Multi-item Checklist Workflow
  addItem: string;
  addPlaceholder: string;
  bulkPasteHint: string;
  activeChecklist: string;
  remainingItems: string;
  itemsCount: string;
  remainingOf: (remaining: number, total: number) => string;
  clearAll: string;
  doneButton: string;
  completedToast: (itemText: string) => string;
  completedAllTitle: string;
  completedAllSubtitle: string;
  startNewBatch: string;
  openDrawer: string;
  closeDrawer: string;
  detectedOnScreen: string;
  emptyQueueWarning: string;
  emptyQueueTip: string;
  completedItemsHistory: string;
  markDoneManual: string;
  cameraSees: string;
  ocrStatus: string;
  autoScan: string;
  tapToScan: string;
  tapScreenToScan: string;
}

export const translations: Record<UILanguage, Translation> = {
  en: {
    appName: 'Live OCR Text Finder',
    appTagline: 'Multi-item camera text scanner & interactive checklist',
    searchPlaceholder: 'Type word, code, or number...',
    startScanning: 'Start Scanning',
    ocrLanguage: 'OCR Language',
    ocrLangEngAra: 'English + Kurdish/Arabic (eng+ara)',
    ocrLangEng: 'English Only (Faster)',
    ocrLangAra: 'Arabic Only (ara)',
    matchMode: 'Match Precision',
    matchContains: 'Contains (Flexible)',
    matchExact: 'Exact Word',
    matchFuzzy: 'Fuzzy / Similar',
    quickPresets: 'Quick Add Presets',
    uploadTestImage: 'Test with Image / Photo',
    installApp: 'Install App',
    installAppBannerTitle: 'Install as Mobile App',
    installAppBannerDesc: 'Add to home screen for fullscreen camera scanning & offline support',
    iosInstallTitle: 'Install on iPhone / iPad',
    iosStep1: 'Tap the Share button in Safari toolbar at the bottom',
    iosStep2: 'Scroll down and tap "Add to Home Screen"',
    close: 'Close',
    cameraBack: 'Back',
    scanning: 'Scanning live feed...',
    searchingFor: 'Searching',
    matchFound: 'Match Found!',
    noMatches: 'Scanning for queue items...',
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
    tipTitle: 'Pro Tips for Multi-Item Scanning',
    tip1: 'Paste multi-line lists (like invoice items or serials) to add them all at once.',
    tip2: 'When an item highlights on camera, tap "Done" to remove it and continue to the next.',
    tip3: 'Tap the counter pill anytime to view or manage the remaining checklist.',
    hapticSoundEnabled: 'Audio/Haptic Alert ON',
    hapticSoundDisabled: 'Alerts Muted',
    sampleImageDemo: 'Try Sample Document',
    confidence: 'Conf',
    offlineBanner: 'Offline Mode active. Cached model and scanner ready.',
    clear: 'Clear',

    // Multi-item Checklist Workflow
    addItem: 'Add',
    addPlaceholder: 'Type target word, code, or paste multiple lines...',
    bulkPasteHint: 'Multi-line paste supported: splits into multiple items',
    activeChecklist: 'Search Queue List',
    remainingItems: 'Remaining',
    itemsCount: 'items',
    remainingOf: (rem, tot) => `Remaining: ${rem} of ${tot}`,
    clearAll: 'Clear All',
    doneButton: 'Done',
    completedToast: (item) => `✓ "${item}" marked done`,
    completedAllTitle: 'All Items Completed!',
    completedAllSubtitle: 'Every target text in your queue has been successfully scanned and verified.',
    startNewBatch: 'Start New Batch',
    openDrawer: 'Queue Checklist',
    closeDrawer: 'Close',
    detectedOnScreen: 'Matched on Camera:',
    emptyQueueWarning: 'Add at least one item to search for before starting camera.',
    emptyQueueTip: 'Add item above or tap popular chips below',
    completedItemsHistory: 'Completed in this session',
    markDoneManual: 'Mark Done',
    cameraSees: 'Camera sees',
    ocrStatus: 'OCR Status',
    autoScan: 'Auto (Cool)',
    tapToScan: 'Tap to Scan',
    tapScreenToScan: 'Tap screen to scan frame',
  },
  ku: {
    appName: 'گەڕانی دەقی ڕاستەوخۆ',
    appTagline: 'سکێنەری کامێرا بۆ چەندین وشە و بەڕێوەبردنی لیستی تەواوکردن',
    searchPlaceholder: 'وشە، نرخ، یان کۆد بنووسە...',
    startScanning: 'دەستپێکردنی گەڕان',
    ocrLanguage: 'زمانی خوێندنەوە (OCR)',
    ocrLangEngAra: 'ئینگلیزی + کوردی/عەرەبی (eng+ara)',
    ocrLangEng: 'تەنها ئینگلیزی (خێراتر)',
    ocrLangAra: 'تەنها عەرەبی (ara)',
    matchMode: 'شێوازی دۆزینەوە',
    matchContains: 'لەخۆگرتن (نەرم)',
    matchExact: 'تەواو هەمان وشە',
    matchFuzzy: 'نزیک لە وشەکە',
    quickPresets: 'پێشنیارە باوەکان',
    uploadTestImage: 'تاقیکردنەوە بە وێنە',
    installApp: 'دابەزاندنی ئەپ',
    installAppBannerTitle: 'دابەزاندن وەک ئەپی مۆبایل',
    installAppBannerDesc: 'زیادی بکە بۆ سەر شاشەی سەرەکی بۆ خێرایی و کارکردنی بێ ئینتەرنێت',
    iosInstallTitle: 'دابەزاندن بۆ ئایفۆن / ئایپاد',
    iosStep1: 'لە سەفاری داگرە لەسەر دوگمەی Share (هاوبەشکردن)',
    iosStep2: 'بڕۆ خوارەوە و داگرە لەسەر "Add to Home Screen"',
    close: 'داخستن',
    cameraBack: 'گەڕانەوە',
    scanning: 'گەڕان بەدوای دانەکانی ناو لیست...',
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
    tipTitle: 'ئامۆژگاری بۆ سکانی چەندین دانە',
    tip1: 'دەتوانیت چەندین دێڕ پێکەوە لێرە کۆپی بکەیت تا هەموویان ببنە دانەی جیاواز.',
    tip2: 'کاتێک لە کامێرادا دۆزرایەوە، دوگمەی "تەواو" دابگرە بۆ سڕینەوەی و گەڕان بەدوای دانەکانی تردا.',
    tip3: 'دەتوانیت لەسەر شریتەکەی سەرەوە داگریت بۆ بینینی هەموو ئەو دانانەی ماون.',
    hapticSoundEnabled: 'لەرین و دەنگ کارایە',
    hapticSoundDisabled: 'بێدەنگ کرا',
    sampleImageDemo: 'نموونەی دۆکیومێنت',
    confidence: 'ڕێژە',
    offlineBanner: 'دۆخی بێ ئینتەرنێت کارایە. سیستەم ئۆفلاین کار دەکات.',
    clear: 'سڕینەوە',

    // Multi-item Checklist Workflow
    addItem: 'زیادکردن',
    addPlaceholder: 'وشە، کۆد بنووسە، یان چەند دێڕێک لێرە دابنێ...',
    bulkPasteHint: 'دەتوانیت چەند دێڕێک پێکەوە لێرە کۆپی بکەیت',
    activeChecklist: 'لیستی گەڕان',
    remainingItems: 'ماوە',
    itemsCount: 'دانە',
    remainingOf: (rem, tot) => `ماوە: ${rem} لە ${tot}`,
    clearAll: 'سڕینەوەی هەمووی',
    doneButton: 'تەواو',
    completedToast: (item) => `✓ "${item}" تەواو بوو`,
    completedAllTitle: 'هەموو نووسینەکان دۆزرانەوە!',
    completedAllSubtitle: 'دەستخۆش! هەموو ئەو وشانەی لە لیستەکەتدا بوون بە سەرکەوتوویی دۆزرانەوە و پشتڕاستکرانەوە.',
    startNewBatch: 'دەستپێکردنەوەی دانەی نوێ',
    openDrawer: 'لیستی گەڕان',
    closeDrawer: 'داخستن',
    detectedOnScreen: 'دۆزراوەتەوە لە کامێرادا:',
    emptyQueueWarning: 'تکایە لانیکەم دانەیەک بنووسە بۆ گەڕان پێش ئەوەی کامێرا بکەیتەوە.',
    emptyQueueTip: 'لە سەرەوە بنووسە یان لە پێشنیارەکانی خوارەوە هەڵبژێرە',
    completedItemsHistory: 'تەواوکراوەکانی ئەمجارە',
    markDoneManual: 'تەواو کرا',
    cameraSees: 'ئەوەی کامێراکە دەیبینێت',
    ocrStatus: 'دۆخی OCR',
    autoScan: 'خۆکار (Auto)',
    tapToScan: 'دەستی (Tap)',
    tapScreenToScan: 'لەسەر شاشەکە داگرە بۆ گەڕان',
  },
  ar: {
    appName: 'الباحث عن النص المباشر',
    appTagline: 'مسح كاميرا فوري لقائمة عناصر متعددة مع التأكيد المباشر',
    searchPlaceholder: 'اكتب الكلمة أو الرمز أو الرقم...',
    startScanning: 'بدء المسح',
    ocrLanguage: 'لغة القراءة (OCR)',
    ocrLangEngAra: 'إنجليزي + عربي/كردي (eng+ara)',
    ocrLangEng: 'إنجليزي فقط (أسرع)',
    ocrLangAra: 'عربي فقط (ara)',
    matchMode: 'دقة المطابقة',
    matchContains: 'يحتوي على (مرن)',
    matchExact: 'مطابقة تامة',
    matchFuzzy: 'تقريبي / مشابه',
    quickPresets: 'إضافة سريعة',
    uploadTestImage: 'تجربة صورة من الجهاز',
    installApp: 'تثبيت التطبيق',
    installAppBannerTitle: 'تثبيت كتطبيق هاتف',
    installAppBannerDesc: 'أضفه للشاشة الرئيسية للتشغيل الفوري بكامل الشاشة وبدون إنترنت',
    iosInstallTitle: 'التثبيت على آيفون / آيباد',
    iosStep1: 'اضغط على زر المشاركة (Share) في أسفل متصفح سفاري',
    iosStep2: 'مرر لأسفل واضغط على "إضافة إلى الشاشة الرئيسية" (Add to Home Screen)',
    close: 'إغلاق',
    cameraBack: 'رجوع',
    scanning: 'جاري المسح المباشر لعناصر القائمة...',
    searchingFor: 'البحث عن',
    matchFound: 'تم العثور على تطابق!',
    noMatches: 'جاري البحث في القائمة...',
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
    tipTitle: 'نصائح لمسح عدة عناصر',
    tip1: 'يمكنك لصق عدة أسطر دفعة واحدة لإضافتها كعناصر منفصلة.',
    tip2: 'عند ظهور تحديد على الكاميرا، اضغط "تم" لحذفه والمتابعة للعنصر التالي.',
    tip3: 'اضغط على عداد العناصر في الأعلى في أي وقت لعرض القائمة المتبقية.',
    hapticSoundEnabled: 'التنبيه والاهتزاز مفعل',
    hapticSoundDisabled: 'كتم التنبيهات',
    sampleImageDemo: 'تجربة مستند تجريبي',
    confidence: 'الدقة',
    offlineBanner: 'وضع عدم الاتصال مفعل. النموذج يعمل محلياً.',
    clear: 'مسح',

    // Multi-item Checklist Workflow
    addItem: 'إضافة',
    addPlaceholder: 'اكتب كلمة أو رمز تتبع، أو الصق عدة أسطر...',
    bulkPasteHint: 'يدعم لصق أسطر متعددة تلقائياً كعناصر منفصلة',
    activeChecklist: 'قائمة البحث',
    remainingItems: 'المتبقي',
    itemsCount: 'عنصر',
    remainingOf: (rem, tot) => `المتبقي: ${rem} من ${tot}`,
    clearAll: 'مسح الكل',
    doneButton: 'تم',
    completedToast: (item) => `✓ تم إنجاز "${item}"`,
    completedAllTitle: 'تم العثور على جميع العناصر!',
    completedAllSubtitle: 'عمل رائع! تم مسح والتحقق من جميع النصوص والرموز في قائمتك بنجاح.',
    startNewBatch: 'بدء دفعة جديدة',
    openDrawer: 'قائمة البحث',
    closeDrawer: 'إغلاق',
    detectedOnScreen: 'مكتشف على الكاميرا:',
    emptyQueueWarning: 'يرجى إضافة عنصر واحد على الأقل للبحث عنه قبل فتح الكاميرا.',
    emptyQueueTip: 'اكتب في الحقل أعلاه أو اختر من الاقتراحات السريعة',
    completedItemsHistory: 'العناصر المكتملة في هذه الجلسة',
    markDoneManual: 'تم',
    cameraSees: 'ما تراه الكاميرا',
    ocrStatus: 'حالة OCR',
    autoScan: 'تلقائي (Auto)',
    tapToScan: 'يدوي (Tap)',
    tapScreenToScan: 'المس الشاشة للمسح',
  },
};

export const PRESETS_BY_LANG: Record<UILanguage, string[]> = {
  en: ['Total', 'Price', 'Expiry', 'Password', 'Invoice', 'Serial', 'Tax', 'Date'],
  ku: ['کۆی گشتی', 'نرخ', 'بەسەرچوون', 'تێپەڕەوشە', 'پسوولە', 'بەروار', 'Total', 'Code'],
  ar: ['المجموع', 'السعر', 'تاريخ الانتهاء', 'كلمة المرور', 'فاتورة', 'الرقم التسلسلي', 'Total', 'PIN'],
};
