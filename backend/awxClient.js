import dotenv from 'dotenv';
dotenv.config();

const BASE = process.env.AWX_URL;
const TOKEN = process.env.AWX_TOKEN;
const headers = { 
  Authorization: `Bearer ${TOKEN}`, 
  'Content-Type': 'application/json' 
};

export async function launchJob(templateId, extraVars = {}) {
  try {
    const res = await fetch(`${BASE}/api/v2/job_templates/${templateId}/launch/`, {
      method: 'POST', 
      headers, 
      body: JSON.stringify({ extra_vars: extraVars })
    });
    
    if (!res.ok) {
      const error = await res.text();
      throw new Error(`AWX launch failed: ${res.status} - ${error}`);
    }
    
    const data = await res.json();
    return data.job; // job id
  } catch (error) {
    console.error('AWX launch error:', error.message);
    throw new Error('AWX unreachable');
  }
}

export async function getJobStatus(jobId) {
  try {
    const res = await fetch(`${BASE}/api/v2/jobs/${jobId}/`, { headers });
    
    if (!res.ok) {
      throw new Error(`AWX status failed: ${res.status}`);
    }
    
    const data = await res.json();
    return { 
      status: data.status, 
      finished: data.finished, 
      failed: data.failed 
    };
  } catch (error) {
    console.error('AWX status error:', error.message);
    throw error;
  }
}

export async function getJobLog(jobId) {
  try {
    const res = await fetch(`${BASE}/api/v2/jobs/${jobId}/stdout/?format=txt`, { headers });
    return res.text();
  } catch (error) {
    console.error('AWX log error:', error.message);
    return `[ERROR] Unable to fetch job log: ${error.message}`;
  }
}

export async function getJobEvents(jobId) {
  try {
    const res = await fetch(
      `${BASE}/api/v2/jobs/${jobId}/job_events/?event=runner_on_ok,runner_on_failed&page_size=50`,
      { headers }
    );
    
    if (!res.ok) {
      throw new Error(`AWX events failed: ${res.status}`);
    }
    
    const data = await res.json();
    return data.results.map(e => ({ 
      task: e.event_data?.task || 'Unknown task', 
      ok: e.event === 'runner_on_ok' 
    }));
  } catch (error) {
    console.error('AWX events error:', error.message);
    return [];
  }
}
