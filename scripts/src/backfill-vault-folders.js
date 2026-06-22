// One-off backfill: give every already-connected page a dedicated Vault folder
// (new pages get one automatically on connect — see platform_accounts.service.js).
// Creates a root folder named after each page that lacks one and links it via
// platform_accounts.vault_folder_id. Idempotent — re-running only fills the gaps.
//
//   cd scripts && npm run vault:backfill-folders
//
// Needs DATABASE_URL (the same MySQL the app uses).

import pool from './db/pool.js';

async function main() {
  const [pages] = await pool.query(
    'SELECT id, account_name FROM platform_accounts WHERE vault_folder_id IS NULL',
  );
  if (!pages.length) {
    console.log('Every page already has a Vault folder. Nothing to do.');
    return;
  }

  let created = 0;
  for (const page of pages) {
    const name = (page.account_name && String(page.account_name).trim()) || `Page ${page.id}`;
    const [res] = await pool.query(
      "INSERT INTO vault_items (parent_id, type, name, uploaded_by) VALUES (NULL, 'folder', ?, 'System')",
      [name],
    );
    await pool.query('UPDATE platform_accounts SET vault_folder_id = ? WHERE id = ?', [res.insertId, page.id]);
    console.log(`  · "${name}" (page ${page.id}) -> vault folder ${res.insertId}`);
    created += 1;
  }
  console.log(`\nDone. Created ${created} Vault folder(s).`);
}

main()
  .catch((err) => {
    console.error('[backfill-vault-folders] failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
