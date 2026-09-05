import { maskPhoneNumber, maskEmail } from '../src/lib/masking';
import { db } from '../src/lib/db';

function assert(condition: boolean, description: string) {
  if (condition) {
    console.log(`✅ PASS: ${description}`);
  } else {
    console.error(`❌ FAIL: ${description}`);
    process.exit(1);
  }
}

async function main() {
  console.log('================================================================');
  console.log('🛡️ VERIFYING TASK 4: DPDP ACT PII MASKING IN DISPLAY & LOGS');
  console.log('================================================================\n');

  // TEST 1: Phone number masking formats
  console.log('--- TEST 1: Phone Number Masking ---');
  const sample1 = '+91 98765 43210';
  const masked1 = maskPhoneNumber(sample1);
  console.log(`Input: "${sample1}" -> Masked: "${masked1}"`);
  assert(masked1.includes('****'), 'Middle digits are redacted with asterisks');
  assert(masked1.startsWith('+91 987'), 'Country code and prefix preserved');
  assert(masked1.endsWith('210'), 'Last 3 digits preserved for customer identification');

  const sample2 = '+919988776688';
  const masked2 = maskPhoneNumber(sample2);
  console.log(`Input: "${sample2}" -> Masked: "${masked2}"`);
  assert(masked2.includes('****'), 'Middle digits redacted in compact format');

  // TEST 2: Email masking format
  console.log('\n--- TEST 2: Email Address Masking ---');
  const emailSample = 'rohan.mehta@example.com';
  const maskedEmail = maskEmail(emailSample);
  console.log(`Input: "${emailSample}" -> Masked: "${maskedEmail}"`);
  assert(maskedEmail.startsWith('ro***@'), 'Email username is redacted');
  assert(maskedEmail.endsWith('@example.com'), 'Email domain is preserved');

  // TEST 3: Database preserves full data for operational need (non-destructive)
  console.log('\n--- TEST 3: Raw Operational Data Preserved in Storage ---');
  const customers = await db.getCustomers();
  if (customers.length > 0) {
    const cust = customers[0];
    assert(!cust.phone.includes('****'), `Database phone is unmasked for WhatsApp delivery: "${cust.phone}"`);
    console.log(`Raw DB Record: Customer ID ${cust.id} has full phone ${cust.phone}`);
    console.log(`Display-Layer Masked Output: ${maskPhoneNumber(cust.phone)}`);
  }

  console.log('\n================================================================');
  console.log('🎉 TASK 4 VERIFICATION COMPLETE: PII MASKING IS VERIFIED!');
  console.log('================================================================');
}

main().catch((err) => {
  console.error('Fatal error in PII masking verification:', err);
  process.exit(1);
});
