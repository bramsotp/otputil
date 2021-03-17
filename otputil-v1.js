/* TODO
    handle missing PGP? already does?
        -> otputil tracks whether public key loaded
        -> otpencrypt does not check

*/

window.otputil = (function(){
    var otputilVersion = '1.0.0-ALPHA2-DEV';

    var public = {
        version: otputilVersion
    };
    var private = {
        prepared: false,
        canEncrypt: false,
        sentFullData: false
    };

    async function prepare(arg) {
        arg = arg || {};

        console.log(`otputil version ${otputilVersion}`);

        var waitForJatos = typeof(arg.jatos) === 'boolean'? arg.jatos : jatosIsPresent();
        if (waitForJatos) {
            console.debug('calling jatosOnloadPromise');
            await jatosOnloadPromise();
            console.debug('jatosOnloadPromise resolved');
        }

        if (arg.encryptPublicKey) {
            console.debug('calling otpencrypt.setPublicKey');
            await otpencrypt.setPublicKey(arg.encryptPublicKey);
            private.canEncrypt = true;
        }

        private.sessionId = componentSessionId();
        console.debug('sessionId=',private.sessionId);
        private.sentPartial = 0;
        private.prepared = true;
    }

    function jsPsychVersion() {
        if (typeof(jsPsych) !== 'object') {
            return undefined;
        }
        else if (typeof(jsPsych.version) === 'function') {
            return jsPsych.version();
        }
        else if (typeof(jsPsych.getProgressBarCompleted) === 'function') {
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
            jatos.onLoad(() => resolve());
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
            //taskId:undefined, // at the moment, this goes in custom
            //task:undefined, // at the moment, this goes in custom
            jatos:true, // true/false; maybe in future 'extended' or 'all' to load ALL values for batch/study/batchjson etc
            jspsych:true, // true/false
            otputil:true, // true/false
            //browser:false,
            //geo:false, // 'country', true/false // see https://geo.ipify.org/
            //ip:false, // TODO see https://www.ipify.org/
            //custom:undefined,
            //style:'properties' // properties/json
            //filter: // maybe later
        }, arg||{});

        var infoData = {};
        if (typeof(arg.custom) === 'object') {
            mergeValueSet(infoData, arg.custom, 'custom');
        }
        if (arg.jatos) {
            mergeValueSet(infoData, {version: jatos.version}, 'jatos');
            mergeValueSet(infoData, jatos.addJatosIds({}), 'jatos');
        }
        if (arg.jspsych) {
            mergeValueSet(infoData, {version: jsPsychVersion()}, 'jspsych');
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
                mergedKey = setName + '_' + key;
                obj[mergedKey] = newVals[key];
            }
        } else {
            obj[setName] = newVals;
        }
    }

    function infoTrial(arg) {
        arg = arg || {};

        return jsPsychDataTrial(function(done) {
            infoVals = info(arg);
            done(infoVals);
        });
    }

    function jsPsychDataTrial(func) {
        return {
            type: 'otp-call-function',
            async: true,
            func: func
        };
    }

    // on_finish > encrypt > on_encrypted
    function trialFinisher(arg) {
        arg = Object.assign({
            encryptIf: 'never', // never/false/true/always/fieldname/callback
            on_finish: undefined, // custom
            on_encrypted: undefined, // n.b. runs asynchronously
            sendPartial: false, // false/true
        }, arg||{});

        if (arg.encryptIf === 'never') {
            arg.encryptIf = false;
        }
        else if (arg.encryptIf === 'always') {
            arg.encryptIf = true;
        }

        var fn = async function(data) {
            // on_finish
            if (typeof(arg.on_finish) === 'function') {
                arg.on_finish(data);
            }

            // encrypt
            var willEncrypt = false;
            if (arg.encryptIf) {
                if (arg.encryptIf === true) {
                    willEncrypt = true;
                }
                else if (typeof(arg.encryptIf) === 'string') {
                    if (!!data[arg.ecryptIf]) {
                        willEncrypt = true;
                    }
                }
                else if (typeof(arg.encryptIf) === 'function') {
                    willEncrypt = !!(arg.encryptIf(data));
                }
                if (willEncrypt) {
                    if (!private.canEncrypt) {
                        throw new Error("Can't encrypt: Private key has not been loaded!");
                    }
                    await otpencrypt.encryptTrialData(data);
                }
            }

            // on_encrypted
            if (typeof(arg.on_encrypted) === 'function') {
                arg.on_encrypted(data);
            }

            // sendPartial
            if (arg.sendPartial) {
                if (private.sentFullData) {
                    console.error("trialFinisher: Ignoring sendPartial because full results already sent to JATOS!");
                } else {
                    jatos.appendResultData(JSON.stringify(partialDataEnvelope(data))+"\n");
                }
            }
        };
        return fn;
    }

    function partialDataEnvelope(data) {
        //var dataJson = JSON.stringify(data);
        var dataEnvelope = {
            partialDataType: 'arrayItem',
            collectionId: private.sessionId,
            content: data,
            //content: dataJson,
            sequence: private.sentPartial
        };
        if (private.sentPartial === 0) {
            dataEnvelope.start = true;
        }
        private.sentPartial++;
        return dataEnvelope;
    }

    // addInteractionEvents > on_finish > encryptResults > on_encrypted > sendResults > on_finish_final > jatosContinue
    // n.b. this doesn't have to run in the jsPsych main on_finish, it could be run earlier e.g. to ensure data are sent before participant sees a "thank you" screen
    function taskFinisher(arg) {
        arg = Object.assign({
            addInteractionEvents: true, // calls otputil.addInteractionEvents()
            on_finish: undefined, // runs before encryption
            // _resultsType: 'json', // not a public option // TODO if needed
            //encryptResults: false,
            // on_encrypted: undefined, // runs after encryption () // TODO if needed
            jatosSendResults: true, // true/false/append
            jatosContinue: true, // true/false/smart[deprecated]/{component:ID}/{position:pos}; could also be a name though?; could handle fn that gets value
        }, arg||{});

        var fn = async function(data) {
            console.debug('taskFinisher is starting');
            await otpencrypt.finish();
            console.debug('finished waiting for any pending trial encryption');

            if (arg.addInteractionEvents) {
                var interactionData = jsPsych.data.getInteractionData().values();
                console.log('interactionData', interactionData);
                // TODO: there has to be a better way!
                jsPsych.data.get().addToLast({interactionData: interactionData});
            }

            if (typeof(arg.on_finish) === 'function') {
                console.debug('Calling custom on_finish');
                await arg.on_finish();
            }

            var dataText = jsPsych.data.get().json();

            /*
            // TO ADD IF NEEDED
            if (arg.encryptResults) {
                // await encrypt .finish
                //await otpencrypt.finish();
                // need data again if was modified?
                var dataText = jsPsych.data.get().json();
                //if (typeof(arg.on_encrypted) // TODO if needed
            }
            */

            if (!!arg.jatosSendResults) {
                if (arg.jatosSendResults === 'append') {
                    console.debug('Sending results via appendResultData');
                    await jatos.appendResultData(dataText);
                    // add try/catch if we will handle errors
                }
                else if (arg.jatosSendResults === true) {
                    console.debug('Sending results via submitResultData');
                    await jatos.submitResultData(dataText);
                    private.sentFullData = true;
                    // add try/catch if we will handle errors
                }
                else {
                    console.error('jatosSendResults argument value not handled:', arg.jatosSendResults);
                }
            } else {
                console.debug('jatosSendResults is false, skipping');
            }

            if (!!arg.jatosContinue) {
                var handled = false;
                if (arg.jatosContinue === true || arg.jatosContinue === 'smart') {
                    console.debug('Calling startNextComponent');
                    jatos.startNextComponent();
                    handled = true;
                }
                // else if (arg.jatosContinue === 'smart') {
                //     var nextPos = undefined;
                //     // jatos.componentPos is 1-based. we want to find next component is active. so we start
                //     // with component index (0-based) equal to jatos.componentPos
                //     for (var i=jatos.componentPos; i<jatos.componentList.length; i++) {
                //         if (jatos.componentList[i].active) {
                //             nextPos = i+1; // did I mention that componentPos is 1-based for some reason?
                //             break;
                //         }
                //     }
                //     if (nextPos !== undefined) {
                //         console.debug('Found "smart" next active compoment, calling startComponentByPos for', nextPos);
                //         jatos.startComponentByPos(nextPos);
                //     } else {
                //         console.debug('Did not find any "smart" next active compoment, calling endStudy');
                //         jatos.endStudy();
                //     }
                //     handled = true;
                // }
                else if (typeof(arg.jatosContinue) === 'object') {
                    console.debug('Calling startComponent or startComponentByPos', arg.jatosContinue);

                    if (typeof(arg.jatosContinue.component) === 'number') {
                        jatos.startComponent(arg.jatosContinue.component);
                        handled = true;
                    }
                    else if (typeof(arg.jatosContinue.pos) === 'number') {
                        jatos.startComponentByPos(arg.jatosContinue.pos);
                        handled = true;
                    }
                }
                if (!handled) {
                    console.error('jatosContinue argument value not handled:', arg.jatosContinue);
                }
            } else {
                console.debug('jatosContinue is false, skipping');
            }
        };
        return fn;
    }

    function resolveValue(x) {
        var value = (typeof(x)==='function'? x() : x);
        return value;
    }

    public.prepare = prepare;
    public.info = info;
    public.infoTrial = infoTrial;
    public.trialFinisher = trialFinisher;
    public.taskFinisher = taskFinisher;
    return public;
})();

window.otpencrypt = (function(){
    var public = {};

    var allEncryptPromises = [];
    var publicKeys = undefined;
    var privateKeys = undefined;
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
        var keyResult = await openpgp.key.readArmored(keyArmored);
        publicKeys = keyResult.keys;
    }

    function encryptTrialData(data) {
        var trialIndex = data.trial_index;

        var encryptPromise = encrypt(data);
        console.log('encryptTrialData, got trialIndex/encryptPromise=', trialIndex, encryptPromise);
        var replaceDataPromise = encryptPromise.then(function(encrypted) {
            replaceTrialData(trialIndex, {encryptedData:encrypted});
        });
        allEncryptPromises.push(replaceDataPromise);
        return replaceDataPromise;
    }

    function encrypt(data) {
        var dataString = '';
        if (typeof(data) === 'object') {
            dataString = JSON.stringify(data);
        }
        else if (typeof(data) === 'string') {
            dataString = data;
        }
        else {
            dataString = String(data);
        }
        //console.log('encrypting:', dataString);

        return openpgp.encrypt({
            message: openpgp.message.fromText(dataString),
            publicKeys: publicKeys
        }).then(encryptResult => encryptResult.data);
    }

    function replaceTrialData(trialIndex, newData) {
        var keepProperties = ['trial_type', 'trial_index', 'time_elapsed', 'internal_node_id'];
        var d = jsPsych.data.get().filter({trial_index:trialIndex}).values();
        if (d.length == 1) {
            console.log('replacing trial data');
            d.forEach(trialData => {
                Object.keys(trialData).filter(x => !keepProperties.includes(x)).forEach(x => {delete trialData[x]});
                Object.keys(newData).forEach(x => {trialData[x] = newData[x]});
            });
        }
        //console.log('replaced data!', d);
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
        var keyResult = await openpgp.key.readArmored(keyArmored);
        privateKeys = keyResult.keys;
    }

    async function decrypt(encryptedArmored) {
        var val = openpgp.decrypt({
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
        var k = openpgp.generateKey({ curve: curve,  userIds: [{ name: args.name, email: args.email, comment: args.comment }] });

    }

    // EXPORT

    public.init = init;
    public.setPublicKey = setPublicKey;
    public.setPrivateKey = setPrivateKey;
    public.encryptTrialData = encryptTrialData;
    public.decrypt = decrypt;
    public.finish = finish;
    public.generateKey = generateKey;
    return public;
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

if (window.jsPsych) {
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