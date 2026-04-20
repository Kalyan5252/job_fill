# Job Autofill Agent Monorepo

## Structure

- `extension/` Chrome MV3 extension
- `backend/` Node.js + Express + MongoDB API
- `shared/` shared schema artifacts

## Quick Start

### 1) Backend setup

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

### 2) Chrome extension setup

1. Open Chrome -> `chrome://extensions`
2. Enable Developer Mode
3. Click "Load unpacked"
4. Select `extension/` folder

### 3) Configure extension/backend

- Backend defaults to `http://localhost:4000`
- No login required for MVP fallback profile
- To use authenticated profile:
  - `POST /api/auth/signup`
  - Save token using `chrome.runtime.sendMessage({type: "SET_AUTH_TOKEN", payload: {token: "..."}})` in extension devtools

## API Overview

### Auth

- `POST /api/auth/signup`
- `POST /api/auth/login`

### Profile

- `GET /api/profile/me`
- `PUT /api/profile/me`
- `POST /api/profile/resume` (multipart form-data: `resume`)
- `POST /api/profile/resume/parse`

### Autofill

- `POST /api/autofill`

Request body:

```json
{
  "formFields": [
    {
      "selector": "#email",
      "label": "Email",
      "placeholder": "name@example.com",
      "name": "email",
      "id": "email",
      "type": "email",
      "tag": "input",
      "options": []
    }
  ],
  "userProfile": {
    "fullName": "Alex Johnson",
    "email": "alex.johnson@example.com",
    "phone": "+1-202-555-0110"
  }
}
```

Response body:

```json
{
  "success": true,
  "mapping": {
    "#email": "alex.johnson@example.com"
  }
}
```

## Notes

- AI-driven mapping requires `OPENAI_API_KEY`.
- If AI fails or key is missing, deterministic fallback mapping is still used.
- Authenticated autofill resolves profile from token-linked DB profile (not client payload).
- File inputs for resume/CV are auto-attached using Chrome Debugger protocol when `resumeFilePath` exists in profile.
