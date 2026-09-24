#!/usr/bin/env node
import { hash, Algorithm } from '@node-rs/argon2';
import { stdin, stdout } from 'process';

function askHidden(question) {
  return new Promise((resolve) => {
    stdout.write(question);
    let answer = '';
    const onData = (char) => {
      char = char.toString();
      switch (char) {
        case '\n':
        case '\r':
        case '\u0004':
          stdin.removeListener('data', onData);
          stdout.write('\n');
          resolve(answer);
          break;
        case '\u0003':
          process.exit(0);
          break;
        default:
          answer += char;
          break;
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  let password = process.argv[2];

  if (!password) {
    password = await askHidden('Enter admin password: ');
    const confirm = await askHidden('Confirm password: ');
    if (password !== confirm) {
      console.error('\nPasswords do not match.');
      process.exit(1);
    }
  }

  if (password.length < 12) {
    console.error('\nPassword must be at least 12 characters.');
    process.exit(1);
  }

  const digest = await hash(password, {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  console.log('\nAdd this to your .env / Vercel environment variables:\n');
  console.log(`ADMIN_PASSWORD_HASH="${digest}"\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
