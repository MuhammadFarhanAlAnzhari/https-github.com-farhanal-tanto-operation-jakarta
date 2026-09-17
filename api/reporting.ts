import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from '@vercel/postgres';

const tableName = 'reporting_data';
const getTableIdentifier = () => sql.identifier([tableName]);

const getDatabaseUrl = () => {
  return (
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.DATABASE_URL ||
    process.env.NEON_DATABASE_URL ||
    ''
  );
};

const ensureTable = async () => {
  if (!getDatabaseUrl()) {
    return;
  }

  await sql`
    CREATE TABLE IF NOT EXISTS reporting_data (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      module_id TEXT NOT NULL,
      report_date DATE,
      depot TEXT,
      shift TEXT,
      in_qty NUMERIC DEFAULT 0,
      out_qty NUMERIC DEFAULT 0,
      repair NUMERIC DEFAULT 0,
      productivity NUMERIC DEFAULT 0,
      yor NUMERIC DEFAULT 0,
      empty_availability NUMERIC DEFAULT 0,
      reefer NUMERIC DEFAULT 0,
      solar_diesel NUMERIC DEFAULT 0,
      manual_data JSONB DEFAULT '{}',
      raw_data JSONB DEFAULT '[]',
      mapping JSONB DEFAULT '{}',
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
};

const normalizePayload = (body: any) => {
  const moduleId = String(body?.moduleId || body?.module_id || 'general');
  const fileName = body?.fileName || body?.file_name || null;
  const rows = Array.isArray(body?.rows) ? body.rows : [];
  const mapping = body?.mapping || {};
  const validation = body?.validation || {};
  const uploadedAt = body?.uploadedAt || body?.uploaded_at || new Date().toISOString();

  return {
    moduleId,
    fileName,
    rows,
    mapping,
    validation,
    uploadedAt,
  };
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const databaseUrl = getDatabaseUrl();
    await ensureTable();

    if (!databaseUrl) {
      return res.status(200).json({
        ok: true,
        data: [],
        warning: 'No database connection string is configured for this environment. Using safe empty response for local development.',
      });
    }

    const { method } = req;

    if (method === 'GET') {
      const rawModuleId = req.query.moduleId;
      const moduleId = Array.isArray(rawModuleId) ? rawModuleId[0] : rawModuleId;
      const rows = await sql`
        SELECT * FROM ${getTableIdentifier()}
        WHERE (${moduleId ?? null}::text IS NULL OR module_id = ${String(moduleId || '')})
        ORDER BY created_at DESC
      `;
      return res.status(200).json({ ok: true, data: rows.rows });
    }

    if (method === 'POST') {
      const payload = normalizePayload(req.body || {});

      if (!payload.moduleId) {
        return res.status(400).json({ ok: false, error: 'moduleId is required.' });
      }

      const result = await sql`
        INSERT INTO ${getTableIdentifier()} (
          module_id,
          report_date,
          depot,
          shift,
          in_qty,
          out_qty,
          repair,
          productivity,
          yor,
          empty_availability,
          reefer,
          solar_diesel,
          manual_data,
          raw_data,
          mapping,
          metadata,
          created_at,
          updated_at
        ) VALUES (
          ${payload.moduleId},
          ${payload.validation?.date || null},
          ${payload.validation?.depot || null},
          ${payload.validation?.shift || null},
          ${payload.validation?.in || 0},
          ${payload.validation?.out || 0},
          ${payload.validation?.repair || 0},
          ${payload.validation?.productivity || 0},
          ${payload.validation?.yor || 0},
          ${payload.validation?.emptyAvailability || 0},
          ${payload.validation?.reefer || 0},
          ${payload.validation?.solar || 0},
          ${JSON.stringify(payload.rows || {})},
          ${JSON.stringify(payload.rows || [])},
          ${JSON.stringify(payload.mapping || {})},
          ${JSON.stringify({ fileName: payload.fileName, uploadedAt: payload.uploadedAt, validation: payload.validation || {} })},
          NOW(),
          NOW()
        )
        RETURNING *;
      `;

      return res.status(201).json({ ok: true, data: result.rows[0] });
    }

    if (method === 'PATCH' || method === 'PUT') {
      const { id, ...rest } = req.body || {};
      if (!id) {
        return res.status(400).json({ ok: false, error: 'id is required.' });
      }

      const payload = normalizePayload(rest);
      const result = await sql`
        UPDATE ${getTableIdentifier()}
        SET
          module_id = ${payload.moduleId},
          mapping = ${JSON.stringify(payload.mapping || {})},
          metadata = ${JSON.stringify({ fileName: payload.fileName, uploadedAt: payload.uploadedAt, validation: payload.validation || {} })},
          raw_data = ${JSON.stringify(payload.rows || [])},
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING *;
      `;

      return res.status(200).json({ ok: true, data: result.rows[0] });
    }

    if (method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) {
        return res.status(400).json({ ok: false, error: 'id is required.' });
      }

      await sql`DELETE FROM ${getTableIdentifier()} WHERE id = ${id}`;
      return res.status(200).json({ ok: true, deleted: true });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  } catch (error: any) {
    console.error('API error:', error);
    return res.status(500).json({
      ok: false,
      error: error.message || 'Unexpected server error',
    });
  }
}
