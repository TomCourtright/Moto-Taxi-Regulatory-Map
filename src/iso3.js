// Country identity for the atlas. PRD.md §9 "Country identity".
//
// Countries are joined to map geometry on ISO 3166-1 alpha-3, never on name —
// the sheet says "Ivory Coast", Natural Earth says "Côte d'Ivoire". The build
// script reports any sheet name that fails to resolve rather than letting the
// country vanish from the map.
//
// NAME_TO_ISO3 is keyed on lowercased sheet names, with aliases for the spellings
// the sheet is likely to drift toward.

export const NAME_TO_ISO3 = {
  // — Africa —
  'algeria': 'DZA', 'angola': 'AGO', 'benin': 'BEN', 'botswana': 'BWA',
  'burkina faso': 'BFA', 'burundi': 'BDI', 'cameroon': 'CMR',
  'cape verde': 'CPV', 'cabo verde': 'CPV',
  'central african republic': 'CAF',
  'chad': 'TCD', 'comoros': 'COM',
  'democratic republic of the congo': 'COD', 'dr congo': 'COD', 'drc': 'COD',
  'republic of the congo': 'COG', 'congo': 'COG', 'congo-brazzaville': 'COG',
  'djibouti': 'DJI', 'egypt': 'EGY', 'equatorial guinea': 'GNQ',
  'eritrea': 'ERI', 'eswatini': 'SWZ', 'swaziland': 'SWZ',
  'ethiopia': 'ETH', 'gabon': 'GAB',
  'the gambia': 'GMB', 'gambia': 'GMB',
  'ghana': 'GHA', 'guinea': 'GIN', 'guinea-bissau': 'GNB',
  'ivory coast': 'CIV', "cote d'ivoire": 'CIV', 'côte d’ivoire': 'CIV', 'côte d\'ivoire': 'CIV',
  'kenya': 'KEN', 'lesotho': 'LSO', 'liberia': 'LBR', 'libya': 'LBY',
  'madagascar': 'MDG', 'malawi': 'MWI', 'mali': 'MLI', 'mauritania': 'MRT',
  'morocco': 'MAR', 'mozambique': 'MOZ', 'namibia': 'NAM', 'niger': 'NER',
  'nigeria': 'NGA', 'rwanda': 'RWA',
  'sao tome and principe': 'STP', 'são tomé and príncipe': 'STP',
  'senegal': 'SEN', 'sierra leone': 'SLE', 'somalia': 'SOM',
  'south africa': 'ZAF', 'south sudan': 'SSD', 'sudan': 'SDN',
  'tanzania': 'TZA', 'togo': 'TGO', 'tunisia': 'TUN', 'uganda': 'UGA',
  'western sahara': 'ESH', 'zambia': 'ZMB', 'zimbabwe': 'ZWE',

  // — Asia —
  'afghanistan': 'AFG', 'armenia': 'ARM', 'azerbaijan': 'AZE',
  'bahrain': 'BHR', 'bangladesh': 'BGD', 'bhutan': 'BTN',
  'cambodia': 'KHM', 'china': 'CHN', 'georgia': 'GEO', 'india': 'IND',
  'indonesia': 'IDN', 'iran': 'IRN', 'iraq': 'IRQ', 'japan': 'JPN',
  'jordan': 'JOR', 'kazakhstan': 'KAZ', 'kuwait': 'KWT', 'kyrgyzstan': 'KGZ',
  'laos': 'LAO', 'lebanon': 'LBN', 'malaysia': 'MYS', 'mongolia': 'MNG',
  'myanmar': 'MMR', 'burma': 'MMR',
  'nepal': 'NPL', 'oman': 'OMN', 'pakistan': 'PAK', 'philippines': 'PHL',
  'qatar': 'QAT', 'saudi arabia': 'SAU',
  'south korea': 'KOR', 'korea, south': 'KOR', 'republic of korea': 'KOR',
  'sri lanka': 'LKA', 'syria': 'SYR', 'taiwan': 'TWN', 'tajikistan': 'TJK',
  'thailand': 'THA', 'turkey': 'TUR', 'türkiye': 'TUR',
  'turkmenistan': 'TKM', 'uzbekistan': 'UZB',
  'vietnam': 'VNM', 'viet nam': 'VNM', 'yemen': 'YEM',

  // — Americas —
  'argentina': 'ARG', 'belize': 'BLZ', 'bolivia': 'BOL', 'brazil': 'BRA',
  'chile': 'CHL', 'colombia': 'COL', 'costa rica': 'CRI',
  'dominican republic': 'DOM', 'ecuador': 'ECU', 'el salvador': 'SLV',
  'guatemala': 'GTM', 'honduras': 'HND', 'mexico': 'MEX', 'nicaragua': 'NIC',
  'panama': 'PAN', 'paraguay': 'PRY', 'peru': 'PER', 'uruguay': 'URY',
  'venezuela': 'VEN',
};

// ISO3 → ISO 3166-1 numeric, which is what the Natural Earth / world-atlas
// TopoJSON uses as its feature id.
export const ISO3_TO_NUM = {
  AFG:'004', AGO:'024', ARG:'032', ARM:'051', AZE:'031', BDI:'108', BEN:'204',
  BFA:'854', BGD:'050', BHR:'048', BLZ:'084', BOL:'068', BRA:'076', BTN:'064',
  BWA:'072', CAF:'140', CHL:'152', CHN:'156', CIV:'384', CMR:'120', COD:'180',
  COG:'178', COL:'170', COM:'174', CPV:'132', CRI:'188', DJI:'262', DOM:'214',
  DZA:'012', ECU:'218', EGY:'818', ERI:'232', ESH:'732', ETH:'231', GAB:'266',
  GEO:'268', GHA:'288', GIN:'324', GMB:'270', GNB:'624', GNQ:'226', GTM:'320',
  HND:'340', IDN:'360', IND:'356', IRN:'364', IRQ:'368', JOR:'400', JPN:'392',
  KAZ:'398', KEN:'404', KGZ:'417', KHM:'116', KOR:'410', KWT:'414', LAO:'418',
  LBN:'422', LBR:'430', LBY:'434', LKA:'144', LSO:'426', MAR:'504', MDG:'450',
  MEX:'484', MLI:'466', MMR:'104', MNG:'496', MOZ:'508', MRT:'478', MWI:'454',
  MYS:'458', NAM:'516', NER:'562', NGA:'566', NIC:'558', NPL:'524', OMN:'512',
  PAK:'586', PAN:'591', PER:'604', PHL:'608', PRY:'600', QAT:'634', RWA:'646',
  SAU:'682', SDN:'729', SEN:'686', SLE:'694', SLV:'222', SOM:'706', SSD:'728',
  STP:'678', SWZ:'748', SYR:'760', TCD:'148', TGO:'768', THA:'764', TJK:'762',
  TKM:'795', TUN:'788', TUR:'792', TWN:'158', TZA:'834', UGA:'800', URY:'858',
  UZB:'860', VEN:'862', VNM:'704', YEM:'887', ZAF:'710', ZMB:'894', ZWE:'716',
};

// Countries too small to appear in the 110m boundary file. They are real
// countries in the dataset and must not silently disappear from the map, so the
// renderer draws them as labelled point markers at these coordinates.
// PRD.md §11 success criterion 1.
export const SMALL_STATE_POINTS = {
  CPV: [-23.6, 15.1],   // Cape Verde
  STP: [6.6, 0.2],      // São Tomé and Príncipe
  COM: [43.3, -11.6],   // Comoros
  BHR: [50.6, 26.0],    // Bahrain
};

export function resolveISO3(name) {
  if (!name) return null;
  const k = name.replace(/\s+/g, ' ').trim().toLowerCase();
  return NAME_TO_ISO3[k] || null;
}
