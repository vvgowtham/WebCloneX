import supabase from './db-client.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const [widgets, samples] = await Promise.all([
      supabase.from('widget_map').select('*').order('id', { ascending: true }),
      supabase.from('sample_targets').select('*').order('id', { ascending: true }),
    ]);
    if (widgets.error) throw widgets.error;
    if (samples.error) throw samples.error;
    return res.status(200).json({ widgets: widgets.data, samples: samples.data });
  } catch (err) {
    console.error('catalog error', err);
    return res.status(500).json({ error: err.message });
  }
}
