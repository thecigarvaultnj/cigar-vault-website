// Serverless function that returns the live count of nj-petition submissions
// from Netlify Forms API. Called by petition.html on page load.

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=60' // cache for 60s to reduce API hits
  };

  try {
    const token = process.env.NETLIFY_ACCESS_TOKEN;
    const siteId = process.env.NETLIFY_SITE_ID;

    if (!token || !siteId) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Missing environment variables', count: null })
      };
    }

    // Fetch all forms for the site to find the nj-petition form ID
    const formsResponse = await fetch(
      `https://api.netlify.com/api/v1/sites/${siteId}/forms`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );

    if (!formsResponse.ok) {
      throw new Error(`Forms API returned ${formsResponse.status}`);
    }

    const forms = await formsResponse.json();
    const petitionForm = forms.find(f => f.name === 'nj-petition');

    if (!petitionForm) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'nj-petition form not found', count: null })
      };
    }

    // submission_count is included in the form object
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        count: petitionForm.submission_count,
        updated: new Date().toISOString()
      })
    };

  } catch (err) {
    console.error('signature-count function error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message, count: null })
    };
  }
};
