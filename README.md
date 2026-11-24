# BiPSU BlueBook — Integrated Phase 1 + Phase 2

A responsive Bluebook reservation and purchasing website using HTML, CSS, vanilla JavaScript, Node.js, Express, MongoDB, JWT, bcrypt, and QR code generation.

## Included in this build

- Student registration and sign-in backed by MongoDB
- Required student school selection (SNHS, STCS, STED, SBM, STHM, SAS, or SCJE) with order totals by school in admin reports
- Administrator account seeding from environment variables
- Bluebook catalog backed by MongoDB
- Online Bluebook purchases and reservations with GCash, Maya, or counter payment choices
- Atomic stock reservation to prevent overselling
- Student order history
- Responsive student, cashier, and administrator workspaces with a saved light/dark theme preference
- Admin inventory and daily, weekly, monthly, quarterly, and annual sales/order/claim reporting with cashier handover attribution
- A cashier payment desk for online receipt review, counter payment recording, claim verification, live shared stock, and cashier-specific sales/activity history
- Private GCash/Maya receipt-image upload with manual verification, following the TIDES payment flow
- Three-step student order flow: choose quantity/payment, complete payment, then view a claim receipt
- Counter lookup QR and downloadable PDF reference for cash reservations
- Downloadable PDF claim receipt with QR for paid orders
- Student top-bar notification after payment verification, with the claim QR, receipt number, and downloadable PDF/QR access
- Account-wide student notification dismissal that hides alerts without deleting order, payment, or receipt records
- Cashier/admin claim-receipt QR scanning with the device camera, an uploaded QR image, or a USB/keyboard scanner. Camera permission is requested only after selecting **Open camera**; uploaded images are decoded locally in the browser.
- A paid claim QR contains a receipt identifier that the server checks against the issued receipt and its verified GCash, Maya, or counter-payment record. An unpaid counter reservation QR only identifies the reservation; it cannot claim a Bluebook.
- Admin order cancellation that preserves audit/report records, restores or releases stock, and flags paid orders for manual refunds
- Admin inventory controls for updating stock and Bluebook price
- Staff/admin claim and admin cancellation operations with MongoDB transactions
- Automatic expiration of unpaid orders and release of reserved stock
- Node.js cluster mode for parallel HTTP request handling across multiple local worker processes, with shared MongoDB-backed authentication rate limits
- Private local or S3-compatible storage for uploaded payment proofs
- A MongoDB lease that coordinates reservation expiration across app hosts
- A separate Node.js Worker Threads benchmark to compare sequential and parallel CPU work (`npm run benchmark`)
- API health endpoint that reports which worker served the request

## Important limitations

- No live GCash, Maya, or PayMongo gateway is connected. Checkout displays the configured GCash and Maya QR images; students must verify the recipient, pay the amount due, and upload a receipt image (JPEG, PNG, or WebP, up to 5 MB locally or 4 MB on Vercel). An authorized cashier must verify that funds were actually received; scanning a QR or uploading an image does not itself confirm payment. Confirm the receiving accounts are authorized before deploying or accepting payments.
- GCash/Maya orders reserve inventory for 24 hours. After staff verifies payment, stock is deducted immediately. Counter reservations expire after 8 hours; a cashier records payment, and stock is deducted when the Bluebook is physically claimed.
- By default, uploaded payment proofs are stored under `backend/private/payment-proofs/`, outside the public web root, and are served only to the student who submitted them or authorized staff. Multi-host deployments must use private S3-compatible storage (`PAYMENT_PROOF_STORAGE=s3`); files are still delivered through the authenticated API.
- A cash reservation QR identifies the order so a cashier can look it up and record payment; it is not proof of payment. Paid orders have a downloadable claim-receipt PDF with a QR. Staff must still verify the paid status in the system before releasing a Bluebook.
- Paid claim-receipt QRs carry a receipt number that the cashier app validates against MongoDB. Scanning a valid receipt marks the order claimed and attributes the sale to that cashier; scan only during physical handover. Older order-reference QRs remain accepted if the matching order still has a valid issued receipt.
- Dismissing a student notification syncs across that student's devices and only hides the alert. It does not remove or alter the underlying order, payment, or receipt.
- Configure pricing, product details, stock, account policy, and collection procedures only after BiPSU approval.
- Sales are counted only after a payment-verified order is physically claimed. Reports use the claim date for sales.
- Admin cancellation retains the order, payment, and receipt audit trail and records the cancellation reason and actor. Reserved stock is released; stock already deducted for paid-but-unclaimed orders is restored. Paid cancellations are flagged for manual refunds; no refund is issued automatically. Claimed orders cannot be cancelled.
- Payment verification, claiming, and admin cancellation use MongoDB transactions, which require a replica set or sharded cluster. For a standalone local Windows service, configure `replication.replSetName: rs0` in `mongod.cfg`, restart MongoDB, initialize the set once with `rs.initiate()`, and add `replicaSet=rs0` to the local `MONGODB_URI`. Back up the service configuration before changing it. MongoDB Atlas also supports transactions.
- Cluster mode runs multiple backend processes on one computer. To scale to multiple computers, point every instance at the same MongoDB replica set and private object-storage bucket. Each app process can attempt reservation expiration, while a shared MongoDB lease coordinates the job across hosts.
- `PAYMENT_PROOF_STORAGE` defaults to `local` for development. Before switching an existing database to S3-compatible storage, copy existing proof files with `npm run migrate:payment-proofs`; the script retains the local originals. Back up the database and proof files before migration.
- The local MongoDB replica set is still a single database server and is not redundant. A production deployment should use a managed MongoDB replica set, private shared object storage, HTTPS, backups, and monitoring. The Worker Threads benchmark is a separate CPU-work experiment and does not process live orders.
- This is a development prototype. Perform security review, privacy review, backups, and operational testing before production use.

## Requirements

- Node.js 20 LTS or later (Node.js 22 LTS recommended)
- npm
- MongoDB (local or Atlas; a replica set is required for transactional workflows)
- VS Code (recommended)

## 1. Extract and open

Extract the ZIP archive, then open the `bipsu-bluebook-complete` folder in VS Code. Open the integrated terminal in that folder. Ensure the terminal path ends with `bipsu-bluebook-complete`.

## 2. Configure MongoDB

For a local MongoDB server, use `mongodb://127.0.0.1:27017/bipsu_bluebook`. For Atlas, create a database user with read/write access, allow your development IP under Network Access, then copy the Node.js connection string. Avoid `0.0.0.0/0` for production.

## 3. Create the environment file

Copy `.env.example` to a new file named `.env` in the project root. Fill in:

```env
PORT=5000
APP_WORKERS=2
INSTANCE_ID=
NODE_ENV=development
TRUST_PROXY=loopback
MONGODB_URI=mongodb://127.0.0.1:27017/bipsu_bluebook
MONGODB_MAX_POOL_SIZE=10
JWT_SECRET=PUT_A_LONG_RANDOM_SECRET_HERE_AT_LEAST_32_CHARACTERS
JWT_EXPIRES_IN=8h
RUN_ORDER_EXPIRATION=true
PAYMENT_PROOF_STORAGE=local
OBJECT_STORAGE_BUCKET=
OBJECT_STORAGE_REGION=
OBJECT_STORAGE_ENDPOINT=
OBJECT_STORAGE_ACCESS_KEY_ID=
OBJECT_STORAGE_SECRET_ACCESS_KEY=
OBJECT_STORAGE_FORCE_PATH_STYLE=false
ADMIN_NAME=BiPSU BlueBook Administrator
ADMIN_EMAIL=admin@bipsu.edu.ph
ADMIN_PASSWORD=PUT_A_UNIQUE_PASSWORD_HERE_AT_LEAST_12_CHARACTERS
CASHIER_1_EMAIL=cashier1@example.edu
CASHIER_1_PASSWORD=UNIQUE_RANDOM_PASSWORD_AT_LEAST_16_CHARACTERS
CASHIER_2_EMAIL=cashier2@example.edu
CASHIER_2_PASSWORD=UNIQUE_RANDOM_PASSWORD_AT_LEAST_16_CHARACTERS
CASHIER_3_EMAIL=cashier3@example.edu
CASHIER_3_PASSWORD=UNIQUE_RANDOM_PASSWORD_AT_LEAST_16_CHARACTERS
CASHIER_4_EMAIL=cashier4@example.edu
CASHIER_4_PASSWORD=UNIQUE_RANDOM_PASSWORD_AT_LEAST_16_CHARACTERS
```

For Atlas, replace the local URI with your cluster connection string. Encode reserved URL characters in the password.

Use your own strong admin password and a random JWT secret. Do not share `.env`, commit it to Git, or send database credentials in screenshots. `.env` is ignored by Git.
`TRUST_PROXY` defaults to `loopback` for a local reverse proxy or development tunnel. In hosted deployments, configure only the platform's trusted proxy address/subnet or a fixed hop count that matches the actual topology; do not use `true` or trust arbitrary forwarded headers.
For multi-host hosting, the health endpoint combines the worker ID with `INSTANCE_ID`; Render automatically provides a unique `RENDER_INSTANCE_ID`. On other platforms, set a non-secret instance identifier unique to each host.

## 4. Install dependencies

In the VS Code PowerShell terminal, run these commands without typing `bash` first:

```powershell
npm install
```

## 5. Create the administrator and initial Bluebook product

```powershell
npm run seed
```

The seed command creates the administrator and the four configured cashier accounts from `.env`, then inserts the initial product if it does not exist. Cashier emails must be unique, passwords must be unique and at least 16 characters, and an existing non-cashier account will not be promoted. Re-running the seed command updates active cashier passwords from `.env`:

- SKU: `BB-001`
- Product: Official Examination Bluebook
- Initial sample price: ₱15.00
- Initial sample stock: 500

These are sample values. Confirm the actual approved price and stock with the university before use. Running the seed command again will not overwrite an existing product or admin account.

## 6. Start the website

```powershell
npm start
```

`npm start` launches the clustered server, using `APP_WORKERS` workers (2–16; default 2). For development with automatic restart in one process, use:

```powershell
npm run dev
```

Open:

- Website: http://localhost:5000
- API health: http://localhost:5000/api/health
- Product API: http://localhost:5000/api/products

The health endpoint should report `"database":"connected"` and an `"instance"` such as `"worker-1"`. `npm run start:single` starts the non-clustered server.

## 7. Create and test a student account

1. Open the website.
2. Select **Create account**.
3. Enter the student's name, student ID, designated school, email, and password (at least 8 characters).
4. Sign in using the new account.
5. Browse the Bluebook catalog.
6. Create a reservation or purchase order.
7. Open **My orders** and view the generated QR code.

Student accounts are not pre-seeded. Register a real test student account yourself.

## 8. Roles, payments, and sales

- **Admin:** manage inventory, price, and orders; cancel eligible orders while retaining audit records; view daily, weekly, monthly, quarterly, and annual sales, order, claim, and cancellation reports, including order totals by student school, Bluebooks sold, and sales attributed to each handover cashier.
- **Cashier:** review submitted GCash/Maya receipts, record counter payments, scan claim receipts using the camera, an uploaded QR image, or a USB/keyboard scanner, see shared inventory refresh every 30 seconds, review sales and quantity for orders they physically handed over, view their recent payment/claim history, and search student accounts by name or student ID (view-only). Camera scans record handover immediately; uploaded images are decoded locally and require selecting **Verify and claim**. Cashiers cannot update inventory.
- **Admin:** manage inventory, orders, prices, cancellations, and reports. The Orders & claims page also supports camera, uploaded-image, and USB/keyboard claim-receipt scanning; claims are attributed to the admin account.
- **Student:** choose quantity and payment method, complete GCash, Maya, or counter payment, receive a notification after verification, then view/download the issued claim receipt and QR. Counter reservations expire after 8 hours if not paid. Existing orders retain the price recorded when they were created.
- For temporary wallet payments, students upload a receipt image and staff verify it manually, matching the TIDES flow. This does not connect to GCash, Maya, or PayMongo. Add a real gateway only after merchant onboarding and webhook configuration.

## 9. Sign in as administrator

Use `ADMIN_EMAIL` and `ADMIN_PASSWORD` from your `.env` file. The admin can view orders, update inventory, manually record verified payments, and record physical claiming. Never use a shared demo password in production.

To reset the password for an existing administrator, set `ADMIN_EMAIL` to that account and `ADMIN_PASSWORD` to a new password of at least 12 characters in `.env`. Ensure `MONGODB_URI` points to the intended Atlas database, then run:

```powershell
npm run admin:reset-password
```

This command only updates the password for an existing active administrator in Atlas; it does not create an account. Keep `.env` private.

## 10. Verify multi-process request handling

```powershell
npm start
```

In a second PowerShell terminal, open several separate HTTP connections and inspect the worker IDs:

```powershell
1..10 | ForEach-Object { (curl.exe -s -H "Connection: close" http://localhost:5000/api/health | ConvertFrom-Json).instance }
```

The results should include multiple worker IDs. Node distributes TCP connections, so a browser reusing a keep-alive connection may continue to show one worker. The shared rate limiter keeps the existing 30-auth-requests-per-15-minutes limit consistent across workers.

## 11. Run the Worker Threads benchmark

```powershell
npm run benchmark
```

This runs independent CPU-bound jobs sequentially and then concurrently using Node.js Worker Threads. It prints measured elapsed time and speedup; it is separate from the live HTTP cluster.

## 12. Basic workflow test

1. Sign in as a student and create a GCash/Maya purchase or reservation, or a counter reservation.
2. For GCash or Maya, scan the displayed QR, verify the recipient, pay, then upload a receipt image. For counter payment, show the order QR or downloaded PDF reference to the cashier.
3. Sign in as admin/cashier and verify a wallet receipt only after independently confirming the payment. For counter reservations, record payment only after receiving cash.
4. The student presents the paid claim-receipt QR when collecting the Bluebook. A cashier or admin can scan it with the camera or a USB/keyboard scanner, or upload an image of the QR. Camera/USB scans record the claim immediately; for an uploaded image, verify the decoded QR and select **Verify and claim**.
5. Scan only when the Bluebook is physically released. The cashier dashboard also retains the manual claim workflow; sales are recorded at handover.

## 13. Prepare a multi-host deployment

The app code is ready to use shared storage and coordinate the expiry task, but hosting accounts and cloud resources must be created by you. A simple no-Docker setup is a Render Node.js web service with multiple instances, MongoDB Atlas, and a private Cloudflare R2 bucket. Render's [web services](https://render.com/docs/web-services) build Node.js apps from Git; R2 supports the [S3 API](https://developers.cloudflare.com/r2/api/s3/api/). AWS S3 is also supported by the same storage adapter.

1. Create a MongoDB Atlas replica set and a database user with only the permissions the app needs. Restrict network access to the hosting provider's outbound addresses where possible.
2. Create a private object-storage bucket. Do not enable public access. Keep its credentials in the host's secret/environment settings.
3. Before cutover, pause writes to the local app and back up the local database and `backend/private/payment-proofs/`.
4. With the local `MONGODB_URI` still pointing at the local database, configure the S3 variables and run `npm run migrate:payment-proofs`. This copies proof files to the bucket without deleting the local copies.
5. Copy the local MongoDB database to Atlas using MongoDB's migration tools. Keep the local backup until the hosted app is fully tested.
6. Configure every hosted web instance with the same Atlas `MONGODB_URI`, `JWT_SECRET`, object-storage settings, and `PAYMENT_PROOF_STORAGE=s3`. Set a unique `INSTANCE_ID` on platforms that do not provide one. Tune `APP_WORKERS` and `MONGODB_MAX_POOL_SIZE` together because each worker opens its own MongoDB pool.
7. Configure `TRUST_PROXY` for the hosting provider's actual trusted proxy addresses or fixed proxy-hop count. Do not use `true` or trust arbitrary forwarded headers.
8. Run at least two web instances behind the provider's HTTPS load balancer. On Render, set the build command to `npm ci`, the start command to `npm run start:single`, and the health-check path to `/api/health`; then scale the service to two instances. The shared MongoDB lease coordinates reservation expiration. Use `npm start` only when you intentionally want multiple Node workers inside each host.
9. Test sign-in, order creation, proof upload/view, cashier verification, cancellation, price updates, and reservation expiration before directing users to the hosted URL. Confirm `/api/health` shows a different instance identifier when requests reach different hosts.

The current development tunnel still points to the server on this computer; it is not the production load balancer. Cloud hosting, Atlas, and bucket accounts are not provisioned by this repository.

For Cloudflare R2, set `OBJECT_STORAGE_REGION=auto`, `OBJECT_STORAGE_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`, and provide the bucket name and S3 API credentials in the hosting dashboard. Do not put real credentials in this file or commit them to Git. Render requires a linked Git repository; this workspace currently has no Git remote, so create/push a repository without `.env` before creating the service.

## 14. Deploy on Vercel

The root `index.js` exports the Express application for Vercel. Vercel serves files in `public/` through its CDN; the app's local Express server and worker cluster remain available for development. Vercel does not run the local interval worker, so order expiration is handled by the protected `/api/cron/expire-orders` route.

1. Push the updated project to GitHub, including `index.js`, `vercel.json`, `backend/`, `public/`, and the root package files. Never commit `.env`, `node_modules/`, or private payment uploads.
2. In Vercel, import the GitHub repository and use the repository root as the project root. Vercel should detect Express from the root `index.js`.
3. Use MongoDB Atlas (a replica set is required for transactions) and configure private S3-compatible storage, such as a private AWS S3 bucket. Vercel requires persistent object storage for payment proofs; its temporary filesystem is not persistent.
4. Add these variables in Vercel's project environment settings for Production and Preview as appropriate: `MONGODB_URI`, `MONGODB_MAX_POOL_SIZE` (start with `5`), `JWT_SECRET` (at least 32 random characters), `JWT_EXPIRES_IN`, `NODE_ENV=production`, `TRUST_PROXY=1`, `RUN_ORDER_EXPIRATION=false`, `CRON_SECRET` (at least 16 random characters), `PAYMENT_PROOF_STORAGE=s3`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_REGION`, `OBJECT_STORAGE_ENDPOINT` when required, `OBJECT_STORAGE_ACCESS_KEY_ID`, `OBJECT_STORAGE_SECRET_ACCESS_KEY`, and `OBJECT_STORAGE_FORCE_PATH_STYLE`. For R2, use region `auto`, your account's R2 endpoint, and the R2 S3 API credentials. Keep the bucket private.
5. The configured expiry schedule runs once per day at 00:00 UTC, which is compatible with Vercel Hobby. Reservations may remain active for up to a day after their expiry time. Use a plan that supports per-minute cron jobs if prompt stock release is required.
6. If using the existing database, migrate it and the payment-proof files to Atlas and S3 before switching users to the Vercel URL. For a new database, run `npm run seed` once from a trusted local machine with the production database connection and the intended admin/cashier seed values in a local, uncommitted `.env`; do not run the seed script as a Vercel build step.
7. Deploy, then verify `/api/health` reports `"database":"connected"`. Test sign-in, order creation, receipt upload and viewing, cashier verification and claiming, admin cancellation, and scheduled expiration before using it with real users.

Atlas must be reachable from Vercel. Prefer a supported static egress/secure connection arrangement and restrict Atlas Network Access accordingly; do not expose database access broadly just to make the connection work. If migrating existing payment proofs, use `npm run migrate:payment-proofs` with a backup and follow the migration instructions above.

For a sign-in-only test without object storage, set `LOGIN_TEST_ONLY=true` and `PAYMENT_PROOF_STORAGE=local` in a non-production local environment. This mode permits sign-in and read requests but disables payment endpoints and all API write operations; order expiration is also paused. It is ignored when `NODE_ENV=production` or on Render. Do not use it for production or transactions. Remove `LOGIN_TEST_ONLY` and configure private S3-compatible storage before enabling normal use.

## 15. Troubleshooting

### `MONGODB_URI is missing`
The `.env` file is missing, is not in the project root, or is named `.env.txt`. Enable file extensions in Windows Explorer and confirm the filename is exactly `.env`.

### `bad auth`
Check the Atlas database username and password. These are database credentials, not your Atlas website login. URL-encode special characters in the password.

### `IP not allowed`
Add your current public IP in Atlas → Network Access.

### `npm is not recognized`
Install Node.js LTS, close and reopen VS Code, then check `node -v` and `npm -v`.

### Port 5000 is already in use
Stop the other server with Ctrl+C, or change `PORT` in `.env` and use the matching localhost URL.

### Transaction / replica set error during claiming
Use MongoDB Atlas or another MongoDB replica-set deployment. A standalone local MongoDB server does not support multi-document transactions.

## Folder structure

```text
bipsu-bluebook-complete/
├── index.js                # Vercel Express entry point
├── vercel.json             # Protected order-expiration schedule
├── backend/
│   ├── app.js
│   ├── cluster.js
│   ├── config/db.js
│   ├── middleware/          # Authentication and shared rate-limit store
│   ├── models/              # User, Product, Order, RateLimitEntry, ScheduledJobLease
│   ├── routes/              # Authentication, orders, cron, and other APIs
│   ├── scripts/             # Seed data and migrate payment proofs
│   ├── services/            # Expiration, distributed lock, proof storage
│   ├── tests/               # Focused automated tests
│   └── server.js
├── public/
│   ├── css/styles.css
│   ├── js/app.js
│   └── index.html
├── .env.example
├── .gitignore
├── package.json
└── README.md
```
