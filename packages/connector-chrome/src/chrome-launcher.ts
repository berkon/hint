/**
 * @fileoverview Launches the given browser with the right configuration to be used via the Chrome Debugging Protocol
 *
 */
import * as chromeLauncher from 'chrome-launcher';
import * as isCI from 'is-ci';

import { debug as d, fs, misc } from '@hint/utils';
import { Launcher } from '@hint/utils-debugging-protocol-common';
import { BrowserInfo, LauncherOptions } from 'hint';

const { readFileAsync, writeFileAsync } = fs;
const { delay } = misc;

const debug: debug.IDebugger = d(__filename);

export class CDPLauncher extends Launcher {
    /** Indicates if the default profile should be used by Chrome or not */
    private userDataDir: string | boolean;
    private chromeFlags: string[];

    public constructor(options: LauncherOptions) {
        const flags = options && options.flags || ['--no-default-browser-check'];

        /* istanbul ignore next */
        if (isCI) {
            flags.push('--headless', '--disable-gpu');
        } else if (process.env.DOCKER === 'true') { // eslint-disable-line no-process-env
            flags.push('--headless');
        }

        super(Object.assign({}, options, { flags: Array.from(new Set(flags)) }));

        this.chromeFlags = flags;
        // `userDataDir` is a property in `chrome-launcher`: https://github.com/GoogleChrome/chrome-launcher#launch-options
        /* istanbul ignore next */
        this.userDataDir = options && typeof options.defaultProfile === 'boolean' && options.defaultProfile ?
            false :
            '';
        this.port = options && options.port;
    }

    /** If a browser is already running, it returns its pid. Otherwise return value is -1.  */
    private async getBrowserInfo(): Promise<BrowserInfo> {
        let result = {
            pid: -1,
            port: this.port
        };

        try {
            result = JSON.parse(await readFileAsync(this.pidFile));
        } catch (e) {
            /* istanbul ignore next */
            { // eslint-disable-line
                debug(`Error reading ${this.pidFile}`);
                debug(e);
                result = {
                    pid: -1,
                    port: this.port
                };
            }
        }

        /* istanbul ignore if */
        if (Number.isNaN(result.pid)) {
            return {
                pid: -1,
                port: this.port
            };
        }

        try {
            /*
             * We test if the process is still running or if it is a leftover:
             * https://nodejs.org/api/process.html#process_process_kill_pid_signal
             */
            /*
             * When running tests serially (because we mock a dependency),
             * sometimes the connector tries to connect to a browser that
             * is being closed and the connection fails. We wait a few
             * milliseconds to make sure this doesn't happen. The number
             * is by trial and error.
             */
            await delay(400);

            process.kill(result.pid, 0);
        } catch (e) {
            /* istanbul ignore next */
            { // eslint-disable-line
                debug(`Process with ${result.pid} doesn't seem to be running`);
                result = {
                    pid: -1,
                    port: this.port
                };
            }
        }

        return result;
    }

    /** Stores the `pid` of the given `child` into a file. */
    private async writePid(browserInfo: BrowserInfo) {
        /* istanbul ignore next */
        await writeFileAsync(this.pidFile, JSON.stringify({ pid: browserInfo.pid, port: browserInfo.port || this.port }, null, 4));
    }

    public async launch(url: string): Promise<BrowserInfo> {

        // If a browser is already launched using `launcher` then we return its PID.
        const currentInfo = await this.getBrowserInfo();

        if (currentInfo.pid !== -1) {
            currentInfo.isNew = false;

            return currentInfo;
        }

        try {
            const chrome: chromeLauncher.LaunchedChrome = await chromeLauncher.launch({
                chromeFlags: this.chromeFlags,
                connectionPollInterval: 1000,
                /* istanbul ignore next */
                logLevel: debug.enabled ? 'verbose' : 'silent',
                port: currentInfo.port,
                startingUrl: url,
                userDataDir: this.userDataDir
            });

            const browserInfo = {
                isNew: true,
                pid: chrome.pid,
                port: chrome.port
            };

            // `chrome` has the final `port` value, regardless if it was via an `option` or random.
            this.port = chrome.port;

            await this.writePid(browserInfo);

            debug('Browser launched correctly');

            return browserInfo;
        } catch (e) {
            /* istanbul ignore next */
            { // eslint-disable-line
                debug('Error launching browser');
                debug(e);

                throw e;
            }
        }
    }
}
