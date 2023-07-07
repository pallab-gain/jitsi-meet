import { v4 as uuidv4 } from 'uuid';

import { CONFERENCE_JOINED } from '../base/conference/actionTypes';
import { IJitsiConference } from '../base/conference/reducer';
import { JitsiConferenceEvents } from '../base/lib-jitsi-meet';
import { CAPTURE_SCREENSHOT_MESSAGE, SEND_SCREENSHOT_MESSAGE } from '../base/media/constants';
import MiddlewareRegistry from '../base/redux/MiddlewareRegistry';

import { captureLargeVideoScreenshot } from './actions';

import './subscriber.web';
import './middleware.any';

/**
 * A {@code Map} temporary holding in transit screen capture chunks.
 */
const receivedScreencaptureMap = new Map();

/**
 * The image chunk size in Bytes <=> 60 KB.
 */
const IMAGE_CHUNK_SIZE = 1024 * 60;

/**
 * Middleware that catches actions related to participants and tracks and
 * dispatches an action to select a participant depicted by LargeVideo.
 *
 * @param {Store} store - Redux store.
 * @returns {Function}
 */
MiddlewareRegistry.register(_store => next => action => {
    switch (action.type) {
    case CONFERENCE_JOINED: {
        _addScreenCaptureListeners(action.conference);
        break;
    }
    }
    const result = next(action);

    return result;
});


/**
 * Registers listener for {@link JitsiConferenceEvents.ENDPOINT_MESSAGE_RECEIVED} that
 * will perform various chat related activities.
 *
 * @param {IJitsiConference} conference - The conference.
 * @returns {void}
 */
function _addScreenCaptureListeners(conference: IJitsiConference) {
    conference.on(
        JitsiConferenceEvents.ENDPOINT_MESSAGE_RECEIVED,
        (...args: any) => {
            if (args && args.length >= 2) {
                const [ sender, eventData ] = args;

                if (eventData.name === CAPTURE_SCREENSHOT_MESSAGE) {
                    APP.store.dispatch(captureLargeVideoScreenshot()).then(dataURL => {
                        if (!dataURL) {
                            return;
                        }

                        const uuId = uuidv4();
                        const size = Math.ceil(dataURL.length / IMAGE_CHUNK_SIZE);
                        let currentIndex = 0;
                        let idx = 0;

                        while (currentIndex < dataURL.length) {
                            const newIndex = currentIndex + IMAGE_CHUNK_SIZE;

                            conference.sendEndpointMessage(sender._id, {
                                name: SEND_SCREENSHOT_MESSAGE,
                                id: uuId,
                                size,
                                idx,
                                chunk: dataURL.slice(currentIndex, newIndex)
                            });
                            currentIndex = newIndex;
                            idx++;
                        }
                    });
                }

                if (eventData.name === SEND_SCREENSHOT_MESSAGE) {
                    if (eventData.id) {
                        if (!receivedScreencaptureMap.has(eventData.id)) {
                            receivedScreencaptureMap.set(eventData.id, new Array(eventData.size));
                        }

                        const arr = receivedScreencaptureMap.get(eventData.id);
                        const { id, idx, chunk, size } = eventData;

                        arr[idx] = chunk;
                        if (idx === size - 1) {
                            const dataURL = arr.join('');

                            APP.API.notifyLargeVideoScreenshotReceived({
                                jid: sender._jid,
                                id: sender._id
                            },
                            dataURL);
                            receivedScreencaptureMap.delete(id);
                        }
                    } else {
                        APP.API.notifyLargeVideoScreenshotReceived({
                            jid: sender._jid,
                            id: sender._id
                        },
                        undefined);
                    }
                }
            }
        }
    );
}
