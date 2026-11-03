# Isolate browser execution behind a bounded control host

Each active Browser owns an independent BrowserWorker utility process, while one DataService owns SQLite. Main holds the execution handle and environment lifecycle; a bounded control host runs automation on a worker thread so a processor loop cannot prevent thread termination and utility-process exit observation.

Native S1 evidence covers selected-task loops, ignored cancellation and SIGTERM, peer/DataService progress, cleanup races and packaged execution on four native targets. The new stop path does not use raw PID termination or utilityProcess.kill. Missing host exit or environment closure keeps ownership blocked; this is not a general native-hang or descendant-process guarantee.

S2 exposes compiled data-service and browser-worker entries and shared public schemas. The existing DataService still imports legacy work execution and Puppeteer to preserve existing routes until S4. BrowserWorker storage isolation is enforced now; final DataService automation isolation follows the S4 migration. S3 tables, import and operation receipts, S4 scheduling and S5 pages are deferred.
