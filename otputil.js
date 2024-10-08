'use strict';
(function() {

    const otputilVersion = '2.2.3';

    /*  Changes
        v2.2.3 - Avoid warning in jsPsych v8.x from embedded otp-call-function plugin
        v2.2.2 - Reduce log output
        v2.2.1 - taskFinisher jatosContinue can be 'endOnly' to await jatos.endStudyAjax; jatosSuccessfulFlag defaults to true
        v2.2.0 - Add taskFinisher.addMessage() and manage JATOS messages through session; addInteractionEvents adds new item in data array
        v2.1.1 - Fix version!
        v2.1.0 - The returned taskFinisher function has new 'options' and 'await' fields'; jatosContinue can be a URL and will call jatos.endStudyAndRedirect; Suppress error messages about batch channel (originating from jatos); Change some var to const/let; Remove ts-ignore comments
                    The options field exposes the original arguments so that they can be changed before the function is called; There are new jatosSuccessfulFlag and jatosMessage options that will be used when calling a jatos function to end the component/study; The await field is an array and await will be called on each item before finishing
        v2.0.1 - Rename to otputil.js
        v2.0.0 - Prevent multiple calls to jatos.endStudy or jatos.startNextComponent etc
        v1.9.5 - Do not send error log if only errors are from external script
        v1.9.4 - Error logging improvements
        v1.9.3 - Don't display (but still log) errors originating from external scripts or browser addons
        v1.9.2 - Handle throwConsoleErrors when error thrown before jatos is initialized
        v1.9.1 - Add 'throwConsoleErrors' option for prepare(); error logging improvements
        v1.9.0 - Improve error logging to jatos; prevent some lint warnings; clean up some commented code
        v1.8.1 - Export otpencrypt.encrypt()
        v1.8.0 - Try to upload error stack traces to jatos
        v1.7.1 - Use sessionData.participant_id instead of participantId
        v1.7.0 - infoTrial includes participantId from sessionData if present
        v1.6.1 - Add optional defaultValue argument to getSessionVar
        v1.6.0 - Add getSessionVar, setSessionVar
        v1.5.0 - Remove 1000ms delay before calling jatos.onLoad(); adapt to work with jsPsych 7.0 (keeping 6.x compatibility); add debugData option for trialFinisher
        v1.4.0 - Add custom order via jatos study json; catch error/unhandledrejection and display via jatos.showOverlay; use strict
        v1.3.0 - Add "browser_userAgent" for infoTrial
        v1.2.0 - Add "jatos_workerType" for infoTrial
        v1.1.0 - Add "timestamp" option for infoTrial; generateKey accepts password; setPrivateKey returns the key(s)

        TODO
        handle missing PGP? already does?
            -> otputil tracks whether public key loaded
            -> otpencrypt does not check
        log the custom order code in infoTrial, if present?

    */

    const w = window;


    // CATCH ERRORS
    const consoleErrOrig = console.error;

    const observedErrors = [];
    let sentErrors = 0;
    const ERRORS_ARRAY_MAX = 100;
    const ERRORS_SEND_DELAY_MS = 50;
    let errorSendTimer = undefined;
    let jatosDisplayMessage = undefined;
    const patternDoNotDisplay = new RegExp(/^Batch channel/);

    function observeError(e) {
        console.debug('otputil caught error', e);
        window['dbgLastError'] = e;
        const jatos = w['jatos'];

        const errorVals = {
            errorEventClass: (e instanceof Object? e.constructor.name : ''),
            errorEventType: '',
            errorClass: '',
            message: '',
            stack: ''
        };

        let displayError = true;

        if (e instanceof PromiseRejectionEvent) {
            errorVals.errorEventType = e.type;
            if (typeof(e.reason) === 'object') {
                errorVals.errorClass = e.reason.constructor.name;
                errorVals.message = e.reason.message;
                errorVals.stack = e.reason.stack;
            }
        }
        else if (e instanceof ErrorEvent) {
            errorVals.errorEventType = e.type;
            errorVals.message = e.message;
            errorVals.filename = e.filename;
            errorVals.lineno = e.lineno;

            if (/^Script error/i.test(errorVals.message) && errorVals.lineno === 0) {
                // it's from a script that is outside the same-origin security context.
                // it could be from a browser addon, or an external script dependency.
                // regardless, an error message like this is essentially uninformative.
                // so: log it but don't make visible to user.
                // https://stackoverflow.com/a/7778424
                // https://stackoverflow.com/questions/5913978/cryptic-script-error-reported-in-javascript-in-chrome-and-firefox
                // https://searchfox.org/mozilla-beta/source/dom/base/nsJSEnvironment.cpp#464
                displayError = false;
            }

            if (e.error instanceof Error) {
                errorVals.errorClass = e.error.constructor.name;
                errorVals.message = e.error.message;
                errorVals.stack = e.error.stack;
            }
        }
        else if (e instanceof Error) {
            errorVals.errorClass = e.constructor.name;
            errorVals.message = e.message;
            errorVals.stack = e.stack;
        }
        else {
            if (typeof(e) === 'object') {
                errorVals.errorEventType = e.type;
                errorVals.message = e.message;
            }
            else if (typeof(e) === 'string') {
                errorVals.errorEventType = 'string';
                errorVals.message = e;
            }
        }

        if (patternDoNotDisplay.test(errorVals.message)) {
            displayError = false;
        }

        let added = false;
        if (observedErrors.length < ERRORS_ARRAY_MAX) {
            observedErrors.push(new Date().toISOString() + " ============");
            observedErrors.push(navigator.userAgent);
            for (let key in errorVals) {
                observedErrors.push(`${key}: ${errorVals[key]}`);
            }
            if (!displayError) {
                observedErrors.push('(not displayed)');
            }
            added = true;
        }

        if (jatos && typeof(jatos.onLoad) === 'function') {
            if (displayError) {
                // try {
                //     sessionStorage.setItem('lastError', JSON.stringify(errorVals));
                //     console.debug('otputil: set lastError successfully', sessionStorage.getItem('lastError'));
                // } catch (err) {
                //     console.debug('otputil: error setting lastError', err);
                // }
                if (!jatosDisplayMessage) {
                    jatosDisplayMessage = `${errorVals.message} (${errorVals.errorClass||''} ${errorVals.type||''}) `;
                }

                jatos.onLoad(function() {
                    try {
                        jatos.showOverlay({
                            text: "ERROR: " + jatosDisplayMessage,
                            showImg: false
                        });
                    } catch (err) {
                        console.warn('Error calling jatos.showOverlay', err);
                    }
                });
            } else {
                // console.debug('Not displaying error', errorVals);
            }

            if (added && (displayError || sentErrors > 0)) { // n.b. can't do this if jatos not defined
                sentErrors++;
                jatos.onLoad(delayedSendObservedErrors);
            }
        }
    }

    function delayedSendObservedErrors() {
        if (errorSendTimer !== undefined) {
            clearTimeout(errorSendTimer);
        }
        errorSendTimer = setTimeout(sendObservedErrors, ERRORS_SEND_DELAY_MS);
    }

    function sendObservedErrors() {
        let returnVal = undefined;
        if (errorSendTimer !== undefined) {
            clearTimeout(errorSendTimer);
            errorSendTimer = undefined;
        }
        if (observedErrors.length > 0) {
            console.debug('otputil uploading error log to jatos');
            try {
                const errorsConcat = [
                    `jatos.componentResultId=${jatos.componentResultId}`,
                    `jatos.studyResultId=${jatos.studyResultId}`
                ].concat(observedErrors).join("\n\n");

                const errorsBlob = new Blob([errorsConcat]);
                const filename = 'ERRORS.txt';
                returnVal = jatos.uploadResultFile(errorsBlob, filename);
            } catch (err) {
                console.warn('Error calling jatos.uploadResultFile', err);
            }
        }
        return returnVal;
    }

    w.addEventListener('error', observeError);
    w.addEventListener('unhandledrejection', observeError);


    // CREATE OTPUTIL

    const jatos = w['jatos'];
    let jsPsych = w['jsPsych'];
    const openpgp = w['openpgp'];

    w.otputil = (function(){
        var _public = {
            version: otputilVersion
        };
        var _private = {
            prepared: false,
            canEncrypt: false,
            sentFullData: false,
            nextComponentId: undefined,
            finishedJatos: false
        };

        async function prepare(arg) {
            arg = arg || {};

            if (arg.throwConsoleErrors === undefined) {
                arg.throwConsoleErrors = false;
            }
            if (Boolean(arg.throwConsoleErrors)) {
                if (console.error === consoleErrOrig) {
                    console.debug('otputil hooking console.error()');
                    console.error = function() {
                        const a = Array.from(arguments);
                        consoleErrOrig.apply(console, a);
                        if (typeof(a[0]) === 'string') {
                            //throw new Error(a[0]);
                            observeError(new Error(a[0])); // but don't throw it!
                        }
                        else if (a[0] instanceof Error) {
                            throw a[0];
                        }
                    }
                } else {
                    console.debug('otputil will not hook console.error(), looks already modified');
                }
            }

            if (arg.jsPsych) {
                jsPsych = arg.jsPsych;
            } else {
                if (!jsPsych) { throw new Error('otputil did not find jsPsych!'); }
            }
            initOtpCallFunction();

            console.info(`otputil version ${otputilVersion}`);

            var waitForJatos = typeof(arg.jatos) === 'boolean'? arg.jatos : jatosIsPresent();
            if (waitForJatos) {
                // console.debug('Calling jatosOnloadPromise');
                await jatosOnloadPromise();
                //console.debug('jatosOnloadPromise resolved');
            }

            if (arg.encryptPublicKey) {
                console.debug('Calling otpencrypt.setPublicKey');
                await otpencrypt.setPublicKey(arg.encryptPublicKey);
                _private.canEncrypt = true;
            }

            _private.nextComponentId = otpComponentOrderManager.getNextComponentId();
            if (_private.nextComponentId === undefined) {
                console.debug('No custom order detected');
            } else {
                console.debug(`Custom order detected; next component id=${_private.nextComponentId}`);
            }

            _private.sessionId = componentSessionId();
            // console.debug('sessionId=',_private.sessionId);
            _private.sentPartial = 0;
            _private.prepared = true;
        }

        function jsPsychVersion() {
            if (typeof(jsPsych) !== 'object') {
                return undefined;
            }
            else if (typeof(jsPsych['version']) === 'function') {
                return jsPsych.version();
            }
            else if (typeof(jsPsych['getProgressBarCompleted']) === 'function') {
                return '6.1.0-or-6.2.0';
            }
            else {
                // Sniffing versions before 6.3.0 looks like a pain
                return 'unknown';
            }
        }

        // UTIL
        function jatosOnloadPromise() {
            return new Promise((resolve, reject) => {
                if (!jatosIsPresent()) {
                    reject('JATOS not loaded!');
                    return;
                }
                setTimeout(function() {
                    jatos.onLoad(() => resolve());
                }, 0);
            });
        }

        // UTIL
        function jatosIsPresent() {
            return (typeof(jatos) === 'object' && typeof(jatos.onLoad) === 'function');
        }

        // UTIL
        function componentSessionId() {
            var bits = [];
            if (jatosIsPresent() && typeof(jatos.studyResultId) === 'string') {
                bits.push(jatos.studyResultId);
            }
            bits.push(randomChars(8));
            return bits.join('-');
        }

        function getSessionVar(key, defaultValue) {
            return jatos.studySessionData[key] !== undefined? jatos.studySessionData[key] :
                    jatos.componentJsonInput[key] !== undefined? jatos.componentJsonInput[key] :
                    jatos.studyJsonInput[key] !== undefined? jatos.studyJsonInput[key] :
                    defaultValue;
        }

        function setSessionVar(key, value) {
            jatos.studySessionData[key] = value;
        }

        // UTIL
        function randomChars(n) {
            // https://stackoverflow.com/questions/1349404/generate-random-string-characters-in-javascript
            var result = '';
            var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
            var charactersLength = characters.length;
            for (var i = 0; i < n; i++) {
                result += characters.charAt(Math.floor(Math.random() * charactersLength));
            }
            return result;
        }

        function info(arg) {
            // this function returns values directly, but in a future version it may need to return a promise
            arg = Object.assign({
                timestamp:true, // true/false
                jatos:true, // true/false; maybe in future 'extended' or 'all' to load ALL values for batch/study/batchjson etc
                jspsych:true, // true/false
                browser:true, // true/false
                otputil:true, // true/false
                //geo:false, // 'country', true/false // see https://geo.ipify.org/
                //ip:false, // see https://www.ipify.org/
                //custom:undefined,
            }, arg||{});

            var infoData = {};
            if (typeof(arg.custom) === 'object') {
                mergeValueSet(infoData, arg.custom, 'custom');
            }
            if (arg.timestamp) {
                var d = new Date();
                mergeValueSet(infoData, {
                    epoch_ms: d.getTime(),
                    iso_string: d.toISOString(),
                    locale_string: d.toLocaleString()
                }, 'timestamp');
            }
            const participantId = getSessionVar('participant_id');
            if (participantId !== undefined) {
                infoData.participant_id = participantId;
            }
            if (arg.jatos) {
                mergeValueSet(infoData, {
                    version: jatos.version,
                    workerType: jatos.workerType
                }, 'jatos');
                mergeValueSet(infoData, jatos.addJatosIds({}), 'jatos');
            }
            if (arg.jspsych) {
                mergeValueSet(infoData, {version: jsPsychVersion()}, 'jspsych');
            }
            if (arg.browser) {
                mergeValueSet(infoData, {userAgent: navigator.userAgent}, 'browser');
            }
            if (arg.otputil) {
                mergeValueSet(infoData, {version: otputilVersion}, 'otputil');
            }
            return infoData;
        }

        function mergeValueSet(obj, newVals, setName) {
            var flat = true;
            setName = setName || '';
            if (flat) {
                for (var key in newVals) {
                    var mergedKey = setName + '_' + key;
                    obj[mergedKey] = newVals[key];
                }
            } else {
                obj[setName] = newVals;
            }
        }

        function infoTrial(arg) {
            arg = arg || {};

            return jsPsychDataTrial(function(done) {
                var infoVals = info(arg);
                done(infoVals);
            });
        }

        function jsPsychDataTrial(func) {
            return {
                type: w['jsPsychOtpCallFunction'] || 'otp-call-function',
                async: true,
                func: func
            };
        }

        // on_finish > encrypt > on_encrypted
        /**
         *
         * @param {{ encryptIf: string | boolean | function; on_finish: (arg0: object) => void; on_encrypted: (arg0: function) => void; sendPartial: boolean; debugData: boolean; }} arg
         */
        function trialFinisher(arg) {
            arg = Object.assign({
                encryptIf: 'never', // never/false/true/always/fieldname/callback
                on_finish: undefined, // custom
                on_encrypted: undefined, // n.b. runs asynchronously
                sendPartial: false, // false/true
                debugData: false // false/true
            }, arg||{});

            if (arg.encryptIf === 'never') {
                arg.encryptIf = false;
            }
            else if (arg.encryptIf === 'always') {
                arg.encryptIf = true;
            }

            const fn = async function(data) {
                // on_finish
                if (typeof(arg.on_finish) === 'function') {
                    await arg.on_finish(data);
                }

                // encrypt
                let willEncrypt = false;
                if (arg.encryptIf) {
                    if (arg.encryptIf === true) {
                        willEncrypt = true;
                    }
                    else if (typeof(arg.encryptIf) === 'string') {
                        if (!!data[arg.encryptIf]) {
                            willEncrypt = true;
                        }
                    }
                    else if (typeof(arg.encryptIf) === 'function') {
                        willEncrypt = !!(arg.encryptIf(data));
                    }
                    if (willEncrypt) {
                        if (!_private.canEncrypt) {
                            throw new Error("Can't encrypt: Private key has not been loaded!");
                        }
                        await otpencrypt.encryptTrialData(data);
                    }
                }

                // on_encrypted
                if (typeof(arg.on_encrypted) === 'function') {
                    arg.on_encrypted(data);
                }

                // debugData
                if (arg.debugData) {
                    console.debug('trial data=', data);
                }

                // sendPartial
                if (arg.sendPartial) {
                    if (_private.sentFullData) {
                        console.warn("trialFinisher: Ignoring sendPartial because full results already sent to JATOS!");
                    } else {
                        jatos.appendResultData(JSON.stringify(partialDataEnvelope(data))+"\n");
                    }
                }
            };
            return fn;
        }

        function partialDataEnvelope(data) {
            const dataEnvelope = {
                partialDataType: 'arrayItem',
                collectionId: _private.sessionId,
                content: data,
                sequence: _private.sentPartial
            };
            if (_private.sentPartial === 0) {
                dataEnvelope.start = true;
            }
            _private.sentPartial++;
            return dataEnvelope;
        }

        // addInteractionEvents > on_finish > encryptResults > on_encrypted > sendResults > on_finish_final > jatosContinue
        // n.b. this doesn't have to run in the jsPsych main on_finish, it could be run earlier e.g. to ensure data are sent before participant sees a "thank you" screen
        /**
         * Creates a taskFinisher function that can be used as a jsPsych study on_finish handler.
         * The sequence of steps is addInteractionEvents > on_finish > sendResults > > await > jatosContinue
         *
         * @param {object} [options] - Optional arguments object
         * @param {boolean} [options.addInteractionEvents] - If true, calls otputil.addInteractionEvents()
         * @param {function} [options.on_finish] - Optional callback function; will be called with the trialFinisher instance as argument
         * @param {boolean|string} [options.jatosSendResults] - true (default), false, or 'append'
         * @param {boolean|string|object|function} [options.jatosContinue] - true/false/'end'/'endOnly'/{component:ID}/{position:pos}
         * @param {string|string[]} [options.jatosMessage] - will be passed to jatos if jatosContinue ends the component
         * @param {boolean} [options.jatosSuccessfulFlag] - will be passed to jatosContinue ends the study
         * @return {function}
         */
        function taskFinisher(arg) {
            arg = Object.assign({
                addInteractionEvents: true, // calls otputil.addInteractionEvents()
                on_finish: undefined, // runs before encryption
                //encryptResults: false, // not currently implemented
                // on_encrypted: undefined, // runs after encryption () // not currently implemented
                jatosSendResults: true, // true/false/append
                jatosContinue: true, // true/false/end/endOnly/{component:ID}/{position:pos}
                jatosMessage: undefined, // will be passed to jatos if jatosContinue ends the component
                jatosSuccessfulFlag: true // will be passed to jatosContinue ends the study
            }, arg||{});

            if (_private.nextComponentId !== undefined) {
                if (arg.jatosContinue === true) {
                    if (_private.nextComponentId === 'end') {
                        arg.jatosContinue = 'end';
                    } else {
                        arg.jatosContinue = {component:_private.nextComponentId};
                    }
                } else {
                    throw new Error('taskFinisher jatosContinue argument must be true (boolean) if there is a custom component order');
                }
            }

            const awaitPromises = [];
            const messages = {
                component: [],
                session: []
            };

            const fn = async function(data) {
                // console.debug('taskFinisher is starting');
                await otpencrypt.finish();
                // console.debug('finished waiting for any pending trial encryption');

                if (arg.addInteractionEvents) {
                    const interactionData = jsPsych.data.getInteractionData().values();
                    jsPsych.data.get().values().push({interactionData: interactionData});
                }

                if (typeof(arg.on_finish) === 'function') {
                    // console.debug('Calling custom on_finish');
                    await arg.on_finish(fn);
                }

                const dataText = jsPsych.data.get().json();

                /*
                // TO ADD IF NEEDED
                if (arg.encryptResults) {
                    // await encrypt .finish
                    //await otpencrypt.finish();
                    // need data again if was modified?
                    const dataText = jsPsych.data.get().json();
                    //if (typeof(arg.on_encrypted) // TODO if needed
                }
                */

                if (Boolean(arg.jatosSendResults)) {
                    if (arg.jatosSendResults === 'append') {
                        // console.debug('Sending results via appendResultData');
                        awaitPromises.push(jatos.appendResultData(dataText));
                        // add try/catch if we will handle errors
                    }
                    else if (arg.jatosSendResults === true) {
                        // console.debug('Sending results via submitResultData');
                        awaitPromises.push(jatos.submitResultData(dataText));
                        _private.sentFullData = true;
                        // add try/catch if we will handle errors
                    }
                    else {
                        console.error('jatosSendResults argument value not handled:', arg.jatosSendResults);
                    }
                } else {
                    console.debug('jatosSendResults is false, skipping');
                }

                for (let i=0; i<awaitPromises.length; i++) {
                    await awaitPromises[i];
                }

                // see jatos.js startNextComponent()
                const lastActiveComponent = jatos.componentList.slice().reverse()
                            .find(function (component) { return component.active; });
                const isLastComponent = jatos.componentPos >= lastActiveComponent.position;

                // update session messages
                messages.session = uniqueArray(getSessionVar('otpSessionMessages', []).concat(messages.session));
                if (messages.session.length > 0) {
                    setSessionVar('otpSessionMessages', messages.session);
                }

                // copy jatosMessage to component messages
                if (arg.jatosMessage !== undefined) {
                    if (arg.jatosMessage instanceof Array) {
                        arg.jatosMessage.forEach(message => messages.component.push(message));
                    } else {
                        messages.component.push(arg.jatosMessage);
                    }
                }

                // add session messages if this is the final component
                // (because as of jatos v3.8.4 the message of the final component is used to set the session message)
                if (isLastComponent && messages.session.length > 0) {
                    messages.component = uniqueArray(messages.session.concat(messages.component));
                }

                // finalize jatosMessage
                if (messages.component.length > 0) {
                    arg.jatosMessage = messages.component.join(', ');
                }

                if (Boolean(arg.jatosContinue)) {
                    try {
                        await sendObservedErrors(); // make sure any errors have been sent
                    } catch (err) {
                        console.warn('error calling sendObservedErrors', err);
                    }

                    if (_private.finishedJatos) {
                        console.debug('Already finished component in JATOS');
                    }
                    else if (arg.jatosContinue === 'end') {
                        console.debug('Calling endStudy');
                        jatos.endStudy(arg.jatosSuccessfulFlag, arg.jatosMessage);
                        _private.finishedJatos = true;
                    }
                    else if (arg.jatosContinue === 'endOnly') {
                        console.debug('Calling endStudyAjax without callback');
                        await jatos.endStudyAjax(arg.jatosSuccessfulFlag, arg.jatosMessage);
                        _private.finishedJatos = true;
                    }
                    else if (/^http/i.test(arg.jatosContinue)) {
                        console.debug('Calling endStudyAndRedirect');
                        jatos.endStudyAndRedirect(arg.jatosContinue, arg.jatosSuccessfulFlag, arg.jatosMessage);
                        _private.finishedJatos = true;
                    }
                    else if (arg.jatosContinue === true) {
                        console.debug('Calling startNextComponent');
                        jatos.startNextComponent(undefined, arg.jatosMessage);
                        _private.finishedJatos = true;
                    }
                    else if (typeof(arg.jatosContinue) === 'object') {
                        console.debug('Calling startComponent or startComponentByPos', arg.jatosContinue);

                        if (typeof(arg.jatosContinue.component) === 'number') {
                            jatos.startComponent(arg.jatosContinue.component, undefined, arg.jatosMessage);
                            _private.finishedJatos = true;
                        }
                        if (typeof(arg.jatosContinue.component) === 'string') {

                            jatos.startComponent(arg.jatosContinue.component, undefined, arg.jatosMessage);
                            _private.finishedJatos = true;
                        }
                        else if (typeof(arg.jatosContinue.pos) === 'number') {
                            jatos.startComponentByPos(arg.jatosContinue.pos, undefined, arg.jatosMessage);
                            _private.finishedJatos = true;
                        }
                    }
                    if (!_private.finishedJatos) {
                        console.error('jatosContinue argument value not handled:', arg.jatosContinue);
                    }
                } else {
                    console.debug('jatosContinue is false, skipping');
                }
            };
            fn.options = arg;
            fn.await = awaitPromises;

            /**
            * Adds a message to be added in the component's JATOS message. All messages will be concatenated with commas.
            * Any messages set with persistToSession will be saved in a session variable to be prepended in the
            * message list of the final component (which will be displayed in JATOS as the session message).
            *
            * @param {string} message - Message text
            * @param {boolean} persistToSession - If true, the message will be added to the session message list
            */
            fn.addMessage = function(message, persistToSession) {
                messages.component.push(message);
                if (persistToSession) {
                    messages.session.push(message);
                }
            };
            return fn;
        }

        function uniqueArray(ar) {
            // https://stackoverflow.com/a/43046408
            const j = {};

            ar.forEach(v => {
                j[v + '::' + typeof(v)] = v;
            });

            return Object.keys(j).map(function(v){
                return j[v];
            });
        }

        function resolveValue(x) {
            const value = (typeof(x)==='function'? x() : x);
            return value;
        }

        _public.prepare = prepare;
        _public.info = info;
        _public.infoTrial = infoTrial;
        _public.trialFinisher = trialFinisher;
        _public.taskFinisher = taskFinisher;
        _public.getSessionVar = getSessionVar;
        _public.setSessionVar = setSessionVar;
        return _public;
    })();

    w.otpencrypt = (function(){
        var _public = {};

        const allEncryptPromises = [];
        let publicKeys = undefined;
        let privateKeys = undefined;
        //var canEncrypt = false;

        async function init(opt) {
            opt = opt || {};
            if (opt.publicKeyArmored) {
                await setPublicKey(opt.publicKeyArmored);
            }
        }

        async function setPublicKey(keyArmored) {
            if (!/-----BEGIN PGP PUBLIC KEY BLOCK-----/.test(keyArmored)) {
                throw new Error("Public key is not in correct format");
            }
            const keyResult = await openpgp.key.readArmored(keyArmored);
            publicKeys = keyResult.keys;
        }

        function encryptTrialData(data) {
            const trialIndex = data.trial_index;

            const encryptPromise = encrypt(data);
            // console.debug('encryptTrialData, got trialIndex/encryptPromise=', trialIndex, encryptPromise);
            const replaceDataPromise = encryptPromise.then(function(encrypted) {
                replaceTrialData(trialIndex, {encryptedData:encrypted});
            });
            allEncryptPromises.push(replaceDataPromise);
            return replaceDataPromise;
        }

        /**
         * Encrypt text or object via openpgp, using publicKeys that were already loaded.
         *
         * @param {string|object} data A string or an object. If an object, will be serialized to JSON text
         * @return {Promise} The Promise returned from openpgp.encrypt
         */
        function encrypt(data) {
            let dataString = '';
            if (typeof(data) === 'object') {
                dataString = JSON.stringify(data);
            }
            else if (typeof(data) === 'string') {
                dataString = data;
            }
            else {
                dataString = String(data);
            }

            return openpgp.encrypt({
                message: openpgp.message.fromText(dataString),
                publicKeys: publicKeys
            }).then(encryptResult => encryptResult.data);
        }

        /**
         * Replace the trial data found in jsPsych at a particular trial, by index.
         * Certain properties in the original trial data will be retained.
         *
         * @param {number} trialIndex Index of position of trial in jsPsych result array (zero-based)
         * @param {object} newData Object containing the replacement data
         */
        function replaceTrialData(trialIndex, newData) {
            const keepProperties = ['trial_type', 'trial_index', 'time_elapsed', 'internal_node_id'];
            const d = jsPsych.data.get().filter({trial_index:trialIndex}).values();
            if (d.length == 1) {
                console.debug('Replacing trial data');
                d.forEach(trialData => {
                    Object.keys(trialData).filter(x => !keepProperties.includes(x)).forEach(x => {delete trialData[x]});
                    Object.keys(newData).forEach(x => {trialData[x] = newData[x]});
                });
            }
        }

        function finish() {
            // should clear allEncryptPromises after?
            return Promise.all(allEncryptPromises);
        }

        // ETC

        async function setPrivateKey(keyArmored) {
            if (!/-----BEGIN PGP PRIVATE KEY BLOCK-----/.test(keyArmored)) {
                throw new Error("Private key is not in correct format");
            }
            const keyResult = await openpgp.key.readArmored(keyArmored);
            privateKeys = keyResult.keys;
            return privateKeys;
        }

        async function decrypt(encryptedArmored) {
            const val = openpgp.decrypt({
                message: await openpgp.message.readArmored(encryptedArmored),
                privateKeys: privateKeys
            }).then(x => x.data);
            return val;
        }

        async function generateKey(args) {
            args = args || {};
            args.curve = args.curve || 'ed25519';
            if (typeof(args.name) !== 'string') {
                throw new Error('generateKey: "name" argument is required');
            }
            const k = await openpgp.generateKey({
                passphrase: args.passphrase,
                curve: args.curve,
                userIds: [{
                    name: args.name,
                    email: args.email,
                    comment: args.comment
                }]
            });
            return k;
        }

        // EXPORT

        _public.init = init;
        _public.setPublicKey = setPublicKey;
        _public.setPrivateKey = setPrivateKey;
        _public.encryptTrialData = encryptTrialData;
        _public.encrypt = encrypt;
        _public.decrypt = decrypt;
        _public.finish = finish;
        _public.generateKey = generateKey;
        return _public;
    })();

    w.otpComponentOrderManager = (function(){
        const _public = {};

        const _private = {
            checked: false,
            nextComponentId: undefined
        //  hasCustomOrder: undefined,
        //  valid: undefined
        }

        _public.getNextComponentId = function() {
            checkCustomOrder();
            return _private.nextComponentId;
        };

        function checkCustomOrder() {
            if (_private.checked) { return; }

            _private.checked = true;
            _private.nextComponentId = undefined;

            // are we running with jatos? if not, order is not applicable
            if (!jatos) { return; }

            // is there a custom order defined in the study json? if not, we have nothing to do
            const o = jatos.studyJsonInput
            if (!(o instanceof Object) || !(o.otputil_order instanceof Object)) { return; }

            // At this point we know that custom order(s) are defined in the study JSON.
            // Any inconsistencies from now on are errors.

            const cl = jatos.componentList;
            if (!(cl instanceof Array)) {
                throw new Error('jatos object does not contain componentList');
            }

            if (!(o.otputil_order.order instanceof Object)) {
                throw new Error('Malformed otputil_order in study json (order parameter missing)');
            }
            if (!(o.otputil_order.uuid instanceof Object)) {
                throw new Error('Malformed otputil_order in study json (uuid parameter missing)');
            }

            let orderCode = jatos.urlQueryParameters.order;
            if (typeof(orderCode) !== 'string') {
                if (jatos.workerType === 'Jatos') {
                    const allOrderCodes = Object.keys(o.otputil_order.order);
                    orderCode = allOrderCodes[0];
                    console.warn(`Component is running with workerType=Jatos, forcing first custom order: ${orderCode}`);
                } else {
                    throw new Error('No order parameter found in URL, but study json contains custom order(s)');
                }
            }
            if (orderCode === 'ignore') {
                // fall back to as-is component order
                console.debug(`Found order=ignore in URL. Ignoring custom component order. Components will be ordered as seen in the study's JATOS configuration.`);
                return;
            }

            if (!(o.otputil_order.order[orderCode] instanceof Array)) {
                throw new Error(`Order '${orderCode}' not found in otputil_order.order in study json`);
            }

            // validate current component in custom order, and find next componentId
            var uuidCurrent = jatos.componentProperties.uuid;
            var usedUuid = {};
            var uuidFirst = undefined;
            var uuidNext = undefined;
            var uuidNextFound = false;
            var iCurrent = undefined;
            var thisOrder = o.otputil_order.order[orderCode];
            for (var i=thisOrder.length-1; i>=0; i--) {
                var thisOrderId = thisOrder[i];
                var thisUuid = o.otputil_order.uuid[thisOrderId];
                if (typeof(thisUuid) !== 'string') {
                    throw new Error(`UUID not found for id ${thisOrderId} used by order ${orderCode}`);
                }
                usedUuid[thisUuid] = 0; // will increment in next loop
                if (thisUuid === uuidCurrent) {
                    iCurrent = i;
                    if (uuidNext === undefined) {
                        // we must be the last component in order
                        uuidNext = 'end';
                        _private.nextComponentId = 'end';
                    }
                    uuidNextFound = true;
                    // whatever the current value of uuidNext, it is the correct value, so stop updating uuidNext
                }
                if (i === 0) {
                    uuidFirst = thisUuid;
                    if (uuidNext === undefined) {
                        throw new Error(`Did not find current component UUID ${uuidCurrent} in list for order ${orderCode}`);
                    }
                }
                if (!uuidNextFound) {
                    uuidNext = thisUuid;
                }
            }
            console.debug(`Order '${orderCode}': iCurrent=${iCurrent}; uuidFirst=${uuidFirst}; uuidCurrent=${uuidCurrent}; uuidNext=${uuidNext}`);

            // validate componentList and find componentId for uuidNext
            if (uuidFirst !== cl[0].uuid) {
                throw new Error(`The first uuid in custom order was not found in first entry of componentList (expected uuid ${uuidFirst})`);
            }
            for (var i=0; i<cl.length; i++) {
                var thisId = cl[i].id;
                var thisUuid = cl[i].uuid;
                if (!cl[i].active) {
                    throw new Error(`Component id ${thisId} is not active, but all components must be active when a custom order is in use`);
                }
                if (!thisUuid) {
                    throw new Error(`No uuid found in componentList for component id ${thisId}. Maybe JATOS needs to be upgraded to a newer version?`);
                }
                if (usedUuid[thisUuid] === undefined) {
                    // should this be an error? could we allow an order that only uses a subset of components?
                    throw new Error(`Component found in componentList but not in order; id=${thisId} uuid=${thisUuid}`);
                }
                usedUuid[thisUuid]++;
                if (thisUuid === uuidNext) {
                    _private.nextComponentId = cl[i].id;
                }
            }
            // verify that all uuids included in order are actually in componentList
            for (var thisUuid in usedUuid) {
                if (usedUuid[thisUuid] === 0) {
                    throw new Error(`Component uuid included in order, but not found in componentList: ${thisUuid}`);
                }
            }
            if (_private.nextComponentId === undefined) {
                throw new Error(`Component id for next component not found; searched for uuid ${uuidNext}`);
            }
            // console.debug(`nextComponentId=${_private.nextComponentId}`);
        };

        return _public;
    })();

    /**
     * https://github.com/jspsych/jsPsych/blob/master/plugins/jspsych-call-function.js
     * COPIED FROM JSPSYCH BRANCH 'master' on 2021-02-20 (code last commit 0b5b300 on Jul 31, 2018):
     *
     * jspsych-call-function
     * plugin for calling an arbitrary function during a jspsych experiment
     * Josh de Leeuw
     *
     * documentation: docs.jspsych.org
     *
     **/

    function initOtpCallFunction() {
        if (jsPsych) {
            const jsPsychModule = window['jsPsychModule'];
            if (jsPsychModule) {
                // adapted from 7.0.0 call-function
                window['jsPsychOtpCallFunction'] = (function (jspsych) {
                    'use strict';

                    const info = {
                        name: "otp-call-function",
                        version: "1.0.1",
                        parameters: {
                            /** Function to call */
                            func: {
                                type: jspsych.ParameterType.FUNCTION,
                                pretty_name: "Function",
                                default: undefined,
                            },
                            /** Is the function call asynchronous? */
                            async: {
                                type: jspsych.ParameterType.BOOL,
                                pretty_name: "Asynchronous",
                                default: false,
                            },
                        },
                        data: {
                            value: {
                                type: jspsych.ParameterType.COMPLEX,
                                default: void 0
                            }
                        },
                    };
                    /**
                     * **call-function**
                     *
                     * jsPsych plugin for calling an arbitrary function during a jsPsych experiment
                     *
                     * @author Josh de Leeuw
                     * @see {@link https://www.jspsych.org/plugins/jspsych-call-function/ call-function plugin documentation on jspsych.org}
                     */
                    class CallFunctionPlugin {
                        constructor(jsPsych) {
                            this.jsPsych = jsPsych;
                        }
                        trial(display_element, trial) {
                            //trial.post_trial_gap = 0;  // TO DO: TS error: number not assignable to type any[]. I don't think this param should be an array..?
                            var return_val;
                            const end_trial = () => {
                                var trial_data = {
                                    value: return_val,
                                };
                                this.jsPsych.finishTrial(trial_data);
                            };
                            if (trial.async) {
                                var done = function (data) {
                                    return_val = data;
                                    end_trial();
                                };
                                trial.func(done);
                            }
                            else {
                                return_val = trial.func();
                                end_trial();
                            }
                        }
                    }
                    CallFunctionPlugin.info = info;

                    return CallFunctionPlugin;

                })(jsPsychModule);
            } else {
                jsPsych.plugins['otp-call-function'] = (function () {
                    var plugin = {};

                    plugin.info = {
                        name: 'call-function',
                        description: '',
                        parameters: {
                            func: {
                                type: jsPsych.plugins.parameterType.FUNCTION,
                                pretty_name: 'Function',
                                default: undefined,
                                description: 'Function to call'
                            },
                            async: {
                                type: jsPsych.plugins.parameterType.BOOL,
                                pretty_name: 'Asynchronous',
                                default: false,
                                description: 'Is the function call asynchronous?'
                            }
                        }
                    }

                    plugin.trial = function (display_element, trial) {
                        trial.post_trial_gap = 0;
                        var return_val;

                        if (trial.async) {
                            var done = function (data) {
                                return_val = data;
                                end_trial();
                            }
                            trial.func(done);
                        } else {
                            return_val = trial.func();
                            end_trial();
                        }

                        function end_trial() {
                            var trial_data = {
                                value: return_val
                            };

                            jsPsych.finishTrial(trial_data);
                        }
                    };

                    return plugin;
                })();
            }
        }
    }
})();
