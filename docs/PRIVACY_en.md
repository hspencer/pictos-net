# Data Architecture and Privacy

PICTOS.net is a research prototype developed as part of doctoral research in design for Augmentative and Alternative Communication (AAC). This document states what data the platform handles, where it resides, and what leaves your device. Every claim here is verifiable by inspection of this repository.

## Research prototype status

PICTOS.net is a public research prototype. No research study is currently recruiting participants through this site, and no research data is being collected from its visitors or users. Should the platform be used within a formal study in the future, participation will be governed by an approved ethics protocol and explicit informed consent. That status will be stated here, but the site itself will not be used to recruit participants.

## Local-first by design

Everything you create in PICTOS.net (pictograms, libraries, working state) is stored in your own browser, on your own device, using IndexedDB and localStorage. There is no server-side database of user content. There are no analytics, no advertising cookies, no third-party trackers, and no behavioural profiling of any kind.

The practical consequence: your work belongs to you, lives with you, and disappears when you clear your browser storage. There is no central copy.

## Authentication and identity

PICTOS.net has no user database of its own. Sign-in exists solely as a human verification mechanism to prevent automated extraction of the AI services, not to identify or profile individuals, and signing in is not enrolment in any study.

Authentication is handled by Netlify Identity (GoTrue), the authentication service of the hosting provider. You may sign in with a Google account or with an email address and a password. Signing in with Google gives the site only your email address, your name and your profile photo URL as supplied by Google; the project receives no access to your Google account and requests nothing else from it. Signing in with email creates a record consisting of your email address and an encrypted password. This sign-in record is the only identity information held on a server.

To enforce the daily generation limit and keep the cost of the AI services bounded, the server also keeps a daily unit counter per email address and an audit log of every model call (`logCall` in `netlify/functions/_shared/usage.js`). Each entry records the email address, the timestamp, the pipeline phase, the model, the units charged, the duration, the token counts, whether the call succeeded, technical request identifiers and, if it failed, a technical error summary. This operational log exists for abuse prevention and cost control; it contains no utterances, prompts, pictograms or images, it is not analysed as research data, and it is not used to contact you.

The system does not store profiles, does not track sessions across visits, and does not build a behavioural history. The costs of the artificial intelligence services are funded by the lead researcher's personal account; users incur no charges and no obligations by using the tool.

## What leaves your device

Only generation requests carry your content across the boundary of your device, and all of them go through the site's own functions (Netlify Functions), which forward them to the provider without keeping them. By phase:

- **COMPRENDER and COMPONER**: the utterance and the configured context (language, region, domain) go to Anthropic or, if you choose GPT-6 Luna, to OpenAI.
- **PRODUCIR**: the image prompt, which includes the utterance, the composition elements and the visual style, goes to OpenAI, Google (Vertex AI) or Recraft, depending on the model selected.
- **ESTRUCTURAR**, when you request it: when structuring from the bitmap, the image, the utterance and the element names first go to Google (Vertex AI) to detect where each element is drawn; then the original image, a rasterised copy with numbered marks, the element tree and a description of the traced regions go to Anthropic. When structuring a trace or a native SVG, the rasterised images, the element tree and the SVG source (up to 10,000 characters) go to Anthropic.

The image generated in PRODUCIR stays in the site's storage only until your browser collects it; it is deleted at that point. The same applies to the input of a background job. Do not type personal information about other people.

If you type a city into the geographic context in the settings, that text is sent to OpenStreetMap's public Nominatim service to suggest places.

Audio recordings made for boards are stored only in your browser and are never sent to a server. Exporting a library, a backup or a PDF produces a file on your device; nothing is published. The application currently offers no way to share pictograms or libraries with a server: the `share-pictogram` function exists in the code, but no interface flow calls it.

The machine API v1 (`/api/v1/*`) is a server-to-server service for other systems; your browser does not use it and it receives nothing from your device.

## Sovereignty

The design principle behind these choices is user sovereignty: the person who creates communication materials, and the person who communicates through them, retain control over that material. Storage on your device, recordings under your control, and open formats (SVG, JSON) that you can take elsewhere at any time.

## Licensing and auditability

The source code is licensed under Apache 2.0. Pictograms generated with the tool may be shared under CC-BY 4.0 at the author's choice. The entire codebase is public in this repository: any statement in this document can be checked against the code, and issues or questions about data handling are welcome through the repository's issue tracker.
