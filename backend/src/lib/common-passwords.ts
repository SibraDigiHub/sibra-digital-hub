// ═══════════════════════════════════════════════════════════
// Common-password blocklist (curated top list + brand terms).
// Embedded at build time — no network lookups, no logging.
// The check is case-insensitive and match-on-substring for the
// most dangerous short entries only.
// ═══════════════════════════════════════════════════════════

/** Short, extremely common passwords — rejected as substrings anywhere. */
export const COMMON_SUBSTRING_PASSWORDS: readonly string[] = [
  'password', 'passw0rd', 'p@ssword', '123456', '1234567', '12345678', '123456789',
  '1234567890', 'qwerty', 'qwertz', 'azerty', 'abc123', '111111', '000000', '121212',
  '123123', '123321', '654321', 'letmein', 'welcome', 'iloveyou', 'admin', 'login',
  'sibra', 'atharva', 'kidosphere', 'passion', 'monkey', 'dragon', 'sunshine',
  'princess', 'football', 'baseball', 'superman', 'batman', 'trustno1', 'master',
  'shadow', 'michael', 'jennifer', 'jordan', 'harley', 'ranger', 'hunter', 'buster',
  'soccer', 'hockey', 'killer', 'george', 'sexy', 'andrew', 'charlie', 'thomas',
  'robert', 'access', 'love', 'secret', 'summer', 'winter', 'spring', 'autumn',
  'asdfgh', 'zxcvbn', 'qazwsx', '1q2w3e', '1qaz2wsx', 'qwertyuiop', 'asdfghjkl',
  'zaq12wsx', 'test', 'guest', 'root', 'toor', 'changeme', 'default', 'sample',
]

/** Full-password blocklist (case-insensitive, exact match) — common top entries. */
export const COMMON_PASSWORDS: readonly string[] = [
  '1234', '12345', '123456', '1234567', '12345678', '123456789', '1234567890',
  '111111', '000000', '121212', '123123', '123321', '112233', '101010', '1230123',
  '666666', '888888', '159753', '987654321', '13579', '135790', '147258369',
  'password', 'password1', 'password12', 'password123', 'password1!', 'passw0rd',
  'passw0rd!', 'passwd', 'pass1234', 'p@ssw0rd', 'p@ssword1', 'secret!@#',
  'qwerty', 'qwerty123', 'qwerty123!', 'qwertyuiop', 'asdfgh', 'asdfghjkl',
  'zxcvbnm', '1q2w3e4r', '1qaz2wsx', 'qazwsx', 'q2w3e4r5t', 'abc123', 'abc123!',
  'letmein', 'letmein!', 'letmein123', 'welcome', 'welcome1', 'welcome123',
  'welcome123!', 'iloveyou', 'iloveyou!', 'iloveyou1', 'admin', 'admin1',
  'admin123', 'admin123!', 'administrator', 'login', 'login123', 'guest',
  'root', 'toor', 'master', 'master123', 'monkey', 'dragon', 'sunshine',
  'princess', 'football', 'baseball', 'basketball', 'superman', 'superman123',
  'batman', 'batman123', 'spiderman', 'pakistan', 'india', 'india123',
  'trustno1', 'shadow', 'shadow123', 'michael', 'michael1', 'jennifer',
  'jordan', 'jordan23', 'harley', 'harley123', 'ranger', 'hunter', 'hunter2',
  'buster', 'soccer', 'hockey', 'killer', 'george', 'charlie', 'thomas',
  'robert', 'access', 'access14', 'love', 'love123', 'sexgod', 'summer',
  'summer!', 'winter', 'spring2024', 'flower', 'flower123', 'hello',
  'hello123', 'helloworld', 'freedom', 'whatever', 'starwars', 'pokemon',
  'pokemon123', 'samsung', 'google', 'google123', 'facebook', 'youtube',
  'amazon', 'apple123', 'nikita', 'naruto', 'naruto123', 'chocolate',
  'cookie', 'cookie123', 'zaq12wsx', 'aaaaaa', 'a1b2c3', 'qwe123', 'asd123',
  'sibra', 'sibra123', 'sibra@123', 'digitalhub', 'digitalkidosphere',
  'atharva', 'atharva123', 'creatorhub', 'kidosphere',
  'india@123', 'india123!', 'abcd1234', 'abcd@1234', 'a123456', 'a12345678',
  'aa123456', 'abc@123', 'test123', 'test1234', 'testing', 'temp123',
  'q1w2e3r4', 'q1w2e3r4t5', '1a2b3c4d', 'abcd@123', 'bangalore123',
  'delhi123', 'mumbai123', 'krishna', 'krishna123', 'ganesh', 'shiva',
  'dhanush', 'rahul', 'rahul123', 'amit', 'amit123', 'priya', 'priya123',
  '123qwe', '123qwe!', '1234qwer', 'zaq!2wsx', 'xsw21qaz', '1234abcd',
  '!@#$%^&*', '!@#$%^&*()', 'qazxsw', '12341234', '11223344', '102030',
  '10203040', '121314', '131313', '141414', '171717', '1989', '2020', '2021',
  '2022', '2023', '2024', '2025', '2580', '1122', '009900', '123654',
  '159357', '789456', '789456123', 'asdf2024', 'asdf1234',
]

const norm = (v: string) => v.toLowerCase()

export interface CommonListCheck {
  /** true when the password is known-common (must be rejected) */
  common: boolean
  reason?: 'substring' | 'exact'
}

export function checkCommonPassword(password: string): CommonListCheck {
  const pw = norm(password)
  const lower = COMMON_SUBSTRING_PASSWORDS.map(norm)
  for (const entry of lower) {
    if (entry.length >= 6 && pw.includes(entry)) return { common: true, reason: 'substring' }
  }
  if ((COMMON_PASSWORDS as readonly string[]).some((p) => norm(p) === pw)) {
    return { common: true, reason: 'exact' }
  }
  return { common: false }
}
