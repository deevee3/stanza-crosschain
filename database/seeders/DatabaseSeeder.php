<?php

namespace Database\Seeders;

use App\Models\Work;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed the application's database with 3 scholarly works.
     * All 3 works are D'Vaughn House's own manuscripts (see
     * docs/manuscripts/qf-replication.md,
     * docs/manuscripts/stanza-license-design.md, and
     * docs/manuscripts/harness-replication.md).
     */
    public function run(): void
    {
        $works = [
            [
                'work_id' => '0x' . hash('sha256', 'manuscript-qf-replication-flexible-design-funding-public-goods'),
                'title' => 'A Replication of "A Flexible Design for Funding Public Goods" (Buterin, Hitzig & Weyl, 2020): Numerical Verification of Quadratic Funding Equilibria',
                'slug' => 'qf-replication-flexible-design-funding-public-goods',
                'scholar_name' => 'D\'Vaughn House',
                'scholar_address' => '0x2c432c901d5844431b027dd652fbfd3cc3dd6094',
                'metadata_uri' => 'https://github.com/deevee3/stanza-crosschain/blob/main/docs/manuscripts/qf-replication.md',
                'description' => 'Independent replication study by D\'Vaughn House (Glenride) verifying Propositions 1-5 and the Section 5.2 collusion arithmetic of Buterin, Hitzig & Weyl (2020), arXiv:1809.06421v2. The original paper is cited as the work being replicated; it is not claimed as the author\'s work. Licensing this manuscript licenses the replication study.',
                'tiers' => [
                    'read' => 1.00,
                    'citation' => 25.00,
                    'commercial' => 150.00,
                    'exclusive' => 500.00,
                ],
                'is_active' => true,
            ],
            [
                'work_id' => '0x' . hash('sha256', 'manuscript-stanza-license-it-from-anywhere-cross-chain-design'),
                'title' => 'License It From Anywhere: A Cross-Chain Design for Licensing Scholarly Works',
                'slug' => 'stanza-license-it-from-anywhere-cross-chain-design',
                'scholar_name' => 'D\'Vaughn House',
                'scholar_address' => '0x2c432c901d5844431b027dd652fbfd3cc3dd6094',
                'metadata_uri' => 'https://github.com/deevee3/stanza-crosschain/blob/main/docs/manuscripts/stanza-license-design.md',
                'description' => 'Design manuscript by D\'Vaughn House (Glenride) for the stanza-crosschain system: NEAR Intents 1Click settles USDC on Base to the scholar, NEAR Chain Signatures MPC authorizes the record with no EVM private key, and LicenseRegistry records the license with replay protection. STANZA credit is on-chain recognition, not a token transfer.',
                'tiers' => [
                    'read' => 1.00,
                    'citation' => 25.00,
                    'commercial' => 150.00,
                    'exclusive' => 500.00,
                ],
                'is_active' => true,
            ],
            [
                'work_id' => '0x' . hash('sha256', 'manuscript-harness-replication-barbaste-2026'),
                'title' => 'A Replication of "Harness Engineering: Anatomy, Architecture, and Evolution of Coding Agents" (Barbaste et al., 2026)',
                'slug' => 'harness-replication-barbaste-2026',
                'scholar_name' => 'D\'Vaughn House',
                'scholar_address' => '0x2c432c901d5844431b027dd652fbfd3cc3dd6094',
                'metadata_uri' => 'https://github.com/deevee3/stanza-crosschain/blob/main/docs/manuscripts/harness-replication.md',
                'description' => 'Independent replication study by D\'Vaughn House (Glenride) verifying the empirical claims and reconstructed mechanisms of Barbaste, Darrigol, Vu & Wiltberger (2026), arXiv:2609.00006v1 — including the twin absences (0/11 agentic frameworks, 0/11 code RAG), the 9/11 multi-agent census, and Listing 3\'s Minimum Viable Harness. The original paper is cited as the work being replicated; it is not claimed as the author\'s work. Licensing this manuscript licenses the replication study.',
                'tiers' => [
                    'read' => 1.00,
                    'citation' => 25.00,
                    'commercial' => 150.00,
                    'exclusive' => 500.00,
                ],
                'is_active' => true,
            ],
        ];

        foreach ($works as $data) {
            Work::updateOrCreate(['slug' => $data['slug']], $data);
        }
    }
}
