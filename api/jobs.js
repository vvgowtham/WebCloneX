import supabase from './db-client.js';

const LIST_COLS =
  'id, url, host, page_title, favicon, platform, mode, status, sections_count, widgets_count, images_count, duration_ms, html_kb, json_kb, error, created_at';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (req.method === 'GET') {
      const { id } = req.query;
      if (id) {
        const { data, error } = await supabase.from('clone_jobs').select('*').eq('id', id).single();
        if (error) throw error;
        return res.status(200).json(data);
      }
      const { data, error } = await supabase
        .from('clone_jobs')
        .select(LIST_COLS)
        .order('created_at', { ascending: false })
        .limit(60);
      if (error) throw error;
      return res.status(200).json(data);
    }

    if (req.method === 'DELETE') {
      let body = req.body || {};
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch {
          body = {};
        }
      }
      const id = body.id || req.query.id;
      if (!id) return res.status(400).json({ error: 'id is required' });
      const { error } = await supabase.from('clone_jobs').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('jobs error', err);
    return res.status(500).json({ error: err.message });
  }
}
