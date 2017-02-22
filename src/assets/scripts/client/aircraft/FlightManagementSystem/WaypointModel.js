/**
 *
 *
 * @class WaypointModel
 */
export default class WaypointModel {
    /**
     *
     * @constructor
     * @for WaypointModel
     * @param waypointProps {object}
     */
    constructor(waypointProps) {
        /**
         *
         *
         * @property name
         * @type {string}
         * @default ''
         */
        this.name = '';

        /**
         *
         *
         * @property _position
         * @type {string}
         * @default null
         * @private
         */
        this._position = null;

        /**
         * Speed restriction for the waypoint.
         *
         * This speed cannot be exceeded.
         *
         * @property speedRestriction
         * @type {number}
         * @default -1
         */
        this.speedRestriction = -1;

        /**
         * Altitude restriction for the waypoint.
         *
         * This altitude cannot be exceeded.
         *
         * @property altitudeRestriction
         * @type {number}
         * @default -1
         */
        this.altitudeRestriction = -1;

        // this.hold = {
        //     dirTurns: null,
        //     fixName: null,
        //     fixPos: null,
        //     inboundHd: null,
        //     legLength: null,
        //     timer: 0
        // };

        this.init(waypointProps);
    }

    /**
     * Return the position array from `#_position` object.
     *
     * @property position
     * @return {array<number>}
     */
    get position() {
        return this._position.position;
    }

    /**
     * Initialize the class properties
     *
     * Should be run only on instantiation
     *
     * @For WaypointModel
     * @method init
     * @param waypointProps {object}
     */
    init(waypointProps) {
        this.name = waypointProps.name.toLowerCase();
        this._position = waypointProps.position;
        this.speedRestriction = parseInt(waypointProps.speedRestriction, 10);
        this.altitudeRestriction = parseInt(waypointProps.altitudeRestriction, 10);
    }

    /**
     * Tear down the instance and reset class properties
     *
     * @for WaypointModel
     * @method destroy
     */
    destroy() {
        this.name = '';
        this._position = null;
        this.speedRestriction = -1;
        this.altitudeRestriction = -1;
    }
}