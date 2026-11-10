// Country list for trips: ISO 3166-1 alpha-2 codes with common English names. A trip stores the code, so entries stay
// consistent whatever the person types. Names are resolved case- and accent-insensitively, with a few common aliases.
const RAW = `AD Andorra|AE United Arab Emirates|AF Afghanistan|AG Antigua and Barbuda|AI Anguilla|AL Albania|AM Armenia|AO Angola|AQ Antarctica|AR Argentina|AS American Samoa|AT Austria|AU Australia|AW Aruba|AX Åland Islands|AZ Azerbaijan|BA Bosnia and Herzegovina|BB Barbados|BD Bangladesh|BE Belgium|BF Burkina Faso|BG Bulgaria|BH Bahrain|BI Burundi|BJ Benin|BL Saint Barthélemy|BM Bermuda|BN Brunei|BO Bolivia|BQ Caribbean Netherlands|BR Brazil|BS Bahamas|BT Bhutan|BV Bouvet Island|BW Botswana|BY Belarus|BZ Belize|CA Canada|CC Cocos (Keeling) Islands|CD DR Congo|CF Central African Republic|CG Republic of the Congo|CH Switzerland|CI Côte d'Ivoire|CK Cook Islands|CL Chile|CM Cameroon|CN China|CO Colombia|CR Costa Rica|CU Cuba|CV Cape Verde|CW Curaçao|CX Christmas Island|CY Cyprus|CZ Czechia|DE Germany|DJ Djibouti|DK Denmark|DM Dominica|DO Dominican Republic|DZ Algeria|EC Ecuador|EE Estonia|EG Egypt|EH Western Sahara|ER Eritrea|ES Spain|ET Ethiopia|FI Finland|FJ Fiji|FK Falkland Islands|FM Micronesia|FO Faroe Islands|FR France|GA Gabon|GB United Kingdom|GD Grenada|GE Georgia|GF French Guiana|GG Guernsey|GH Ghana|GI Gibraltar|GL Greenland|GM Gambia|GN Guinea|GP Guadeloupe|GQ Equatorial Guinea|GR Greece|GS South Georgia and the South Sandwich Islands|GT Guatemala|GU Guam|GW Guinea-Bissau|GY Guyana|HK Hong Kong|HM Heard Island and McDonald Islands|HN Honduras|HR Croatia|HT Haiti|HU Hungary|ID Indonesia|IE Ireland|IL Israel|IM Isle of Man|IN India|IO British Indian Ocean Territory|IQ Iraq|IR Iran|IS Iceland|IT Italy|JE Jersey|JM Jamaica|JO Jordan|JP Japan|KE Kenya|KG Kyrgyzstan|KH Cambodia|KI Kiribati|KM Comoros|KN Saint Kitts and Nevis|KP North Korea|KR South Korea|KW Kuwait|KY Cayman Islands|KZ Kazakhstan|LA Laos|LB Lebanon|LC Saint Lucia|LI Liechtenstein|LK Sri Lanka|LR Liberia|LS Lesotho|LT Lithuania|LU Luxembourg|LV Latvia|LY Libya|MA Morocco|MC Monaco|MD Moldova|ME Montenegro|MF Saint Martin|MG Madagascar|MH Marshall Islands|MK North Macedonia|ML Mali|MM Myanmar|MN Mongolia|MO Macau|MP Northern Mariana Islands|MQ Martinique|MR Mauritania|MS Montserrat|MT Malta|MU Mauritius|MV Maldives|MW Malawi|MX Mexico|MY Malaysia|MZ Mozambique|NA Namibia|NC New Caledonia|NE Niger|NF Norfolk Island|NG Nigeria|NI Nicaragua|NL Netherlands|NO Norway|NP Nepal|NR Nauru|NU Niue|NZ New Zealand|OM Oman|PA Panama|PE Peru|PF French Polynesia|PG Papua New Guinea|PH Philippines|PK Pakistan|PL Poland|PM Saint Pierre and Miquelon|PN Pitcairn Islands|PR Puerto Rico|PS Palestine|PT Portugal|PW Palau|PY Paraguay|QA Qatar|RE Réunion|RO Romania|RS Serbia|RU Russia|RW Rwanda|SA Saudi Arabia|SB Solomon Islands|SC Seychelles|SD Sudan|SE Sweden|SG Singapore|SH Saint Helena|SI Slovenia|SJ Svalbard and Jan Mayen|SK Slovakia|SL Sierra Leone|SM San Marino|SN Senegal|SO Somalia|SR Suriname|SS South Sudan|ST São Tomé and Príncipe|SV El Salvador|SX Sint Maarten|SY Syria|SZ Eswatini|TC Turks and Caicos Islands|TD Chad|TF French Southern Territories|TG Togo|TH Thailand|TJ Tajikistan|TK Tokelau|TL Timor-Leste|TM Turkmenistan|TN Tunisia|TO Tonga|TR Türkiye|TT Trinidad and Tobago|TV Tuvalu|TW Taiwan|TZ Tanzania|UA Ukraine|UG Uganda|UM U.S. Minor Outlying Islands|US United States|UY Uruguay|UZ Uzbekistan|VA Vatican City|VC Saint Vincent and the Grenadines|VE Venezuela|VG British Virgin Islands|VI U.S. Virgin Islands|VN Vietnam|VU Vanuatu|WF Wallis and Futuna|WS Samoa|XK Kosovo|YE Yemen|YT Mayotte|ZA South Africa|ZM Zambia|ZW Zimbabwe`;

/** [[code, name], ...] sorted by name. */
export const COUNTRIES = RAW.split('|').map((s) => [s.slice(0, 2), s.slice(3)]).sort((a, b) => a[1].localeCompare(b[1]));

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const byName = new Map(COUNTRIES.map(([c, n]) => [norm(n), c]));
const byCode = new Map(COUNTRIES.map(([c, n]) => [c, n]));
// names people and AI assistants commonly use for the same places
const ALIASES = {
  usa: 'US', 'u s a': 'US', 'united states of america': 'US', america: 'US', uk: 'GB', 'u k': 'GB', 'great britain': 'GB', britain: 'GB', england: 'GB',
  turkey: 'TR', 'czech republic': 'CZ', 'ivory coast': 'CI', burma: 'MM', swaziland: 'SZ', macao: 'MO', prc: 'CN', 'peoples republic of china': 'CN',
  'mainland china': 'CN', 'russian federation': 'RU', 'viet nam': 'VN', 'hong kong sar': 'HK', 'macao sar': 'MO', 'republic of korea': 'KR',
  'timor leste': 'TL', 'east timor': 'TL', 'holland': 'NL', 'uae': 'AE', 'democratic republic of the congo': 'CD', 'dr congo': 'CD',
};

/** A country code from a code ("cn", "CN") or a name ("China", "côte d'ivoire", "UK"), or null if it is not a known country. */
export function countryCode(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (/^[A-Za-z]{2}$/.test(s) && byCode.has(s.toUpperCase())) return s.toUpperCase();
  const n = norm(s);
  return byName.get(n) ?? ALIASES[n] ?? null;
}

export const countryName = (code) => byCode.get(code) ?? '';
