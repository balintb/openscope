import _floor from 'lodash/floor';
import _isNil from 'lodash/isNil';
import _isObject from 'lodash/isObject';
import _isEmpty from 'lodash/isEmpty';
import RouteModel from '../../navigationLibrary/Route/RouteModel';
import { clamp } from '../../math/core';
import {
    groupNumbers,
    radio_altitude,
    radio_heading,
    radio_runway,
    radio_spellOut,
    radio_trend
} from '../../utilities/radioUtilities';
import {
    degreesToRadians,
    heading_to_string
} from '../../utilities/unitConverters';
import { radians_normalize } from '../../math/circle';
import {
    FLIGHT_CATEGORY,
    FLIGHT_MODES
} from '../../constants/aircraftConstants';
import {
    MCP_MODE,
    MCP_MODE_NAME,
    MCP_FIELD_NAME
} from '../ModeControl/modeControlConstants';

/**
 * Executes control actions upon the aircraft by manipulating the MCP and FMS, and provides
 * readbacks to air traffic control instructions.
 *
 * @class Pilot
 */
export default class Pilot {
    /**
     * @for Pilot
     * @constructor
     * @param modeController {ModeController}
     * @param fms {Fms}
     */
    constructor(modeController, fms) {
        if (!_isObject(modeController) || _isEmpty(modeController)) {
            throw new TypeError('Invalid parameter. expected modeController to an instance of ModeController');
        }

        if (!_isObject(fms) || _isEmpty(fms)) {
            throw new TypeError('Invalid parameter. expected fms to an instance of Fms');
        }

        /**
         * @property _mcp
         * @type {ModeController}
         * @default modeController
         * @private
         */
        this._mcp = modeController;

        /**
         * @property _fms
         * @type {Fms}
         * @default fms
         * @private
         */
        this._fms = fms;
    }

    /**
     * Maintain a given altitude
     *
     * @for Pilot
     * @method maintainAltitude
     * @param {Number} altitude   the altitude to maintain, in feet
     * @param {Boolean} expedite  whether to use maximum possible climb/descent rate
     * @return {Array}            [success of operation, readback]
     */
    maintainAltitude(currentAltitude, altitude, expedite, shouldUseSoftCeiling, airportModel) {
        const { minAssignableAltitude, maxAssignableAltitude } = airportModel;
        // TODO: this could probably be done in the AirportModel
        // FIXME: we should set a new var here instead of reassigning to the param
        altitude = clamp(minAssignableAltitude, altitude, maxAssignableAltitude);

        if (shouldUseSoftCeiling && altitude === maxAssignableAltitude) {
            altitude += 1;  // causes aircraft to 'leave' airspace, and continue climb through ceiling
        }

        this._mcp.setAltitudeHoldWithValue(altitude);

        // TODO: this could be split to another method
        // Build readback
        altitude = _floor(altitude, -2);
        const altitudeInstruction = radio_trend('altitude', currentAltitude, altitude);
        const altitudeVerbal = radio_altitude(altitude);
        let expediteReadback = '';

        if (expedite) {
            // including space here so when expedite is false there isnt an extra space after altitude
            expediteReadback = ' and expedite';

            this.shouldExpediteAltitudeChange();
        }

        const readback = {};
        readback.log = `${altitudeInstruction} ${altitude}${expediteReadback}`;
        readback.say = `${altitudeInstruction} ${altitudeVerbal}${expediteReadback}`;

        return ['ok', readback];
    }

    /**
     * Maintain a given heading
     *
     * @for Pilot
     * @method maintainHeading
     * @param {Number} heading - the heading to maintain, in radians_normalize
     * @param {String} direction - (optional) the direction of turn; either 'left' or 'right'
     * @param {Boolean} incremental - (optional) whether the value is a numeric heading, or a number of degrees to turn
     * @return {Array} [success of operation, readback]
     */
    maintainHeading(heading, direction, incremental) {
        let degrees;

        // TODO: this math should be an external helper function
        if (incremental) {
            degrees = heading;
            // FIXME: pass in the current heading when calling this method from the AircraftCommander
            const aircraft = { heading: 0 };    // FIXME: How can the Pilot access the current heading?

            if (direction === 'left') {
                heading = radians_normalize(aircraft.heading - degreesToRadians(degrees));
            } else if (direction === 'right') {
                heading = radians_normalize(aircraft.heading + degreesToRadians(degrees));
            }
        }

        this._mcp.setHeadingVorLoc(heading);
        this._mcp.setHeadingHold();

        // Build readback
        const heading_string = heading_to_string(heading);
        const readback = {};
        readback.log = `fly heading ${heading_string}`;
        readback.say = `fly heading ${radio_heading(heading_string)}`;

        if (incremental) {
            readback.log = `turn ${degrees} degrees ${direction}`;
            readback.say = `turn ${groupNumbers(degrees)} degrees ${direction}`;
        } else if (direction) {
            readback.log = `turn ${direction} heading ${heading_string}`;
            readback.say = `turn ${direction} heading ${radio_heading(heading_string)}`;
        }

        return [true, readback];
    }

    /**
     * Maintain the aircraft's present magnetic heading
     *
     * @for Pilot
     * @method maintainPresentHeading
     * @param {Number} heading - the heading the aircraft is facing at the time the command is given
     * @return {Array} [success of operation, readback]
     */
    maintainPresentHeading(heading) {
        this._mcp.setHeadingVorLoc(heading);
        this._mcp.setHeadingHold();

        const readback = {};
        readback.log = 'fly present heading';
        readback.say = 'fly present heading';

        return [true, readback];
    }

    /**
     * Maintain a given speed
     *
     * @for Pilot
     * @method maintainSpeed
     * @param {Number} speed - the speed to maintain, in knots
     * @return {Array} [success of operation, readback]
     */
    maintainSpeed(speed) {
        const aircraft = { speed: 0 };  // FIXME: How can the pilot access the aircraft's current speed?
        const instruction = radio_trend('speed', aircraft.speed, speed);

        this._mcp.setSpeedFieldValue(speed);
        this._mcp.setSpeedHold();

        // Build the readback
        const readback = {};
        readback.log = `${instruction} ${speed}`;
        readback.say = `${instruction} ${radio_spellOut(speed)}`;

        return [true, readback];
    }

    /**
     * Apply the specified arrival procedure by adding it to the fms route
     * Note: SHOULD NOT change the heading mode
     *
     * @for Pilot
     * @method applyArrivalProcedure
     * @param routeString {String}  route string in the form of `entry.procedure.airport`
     * @return {Array}              [success of operation, readback]
     */
    applyArrivalProcedure(routeString, arrivalRunway, airportName) {
        if (!this._fms.isValidProcedureRoute(routeString, arrivalRunway, FLIGHT_CATEGORY.ARRIVAL)) {
            // TODO: may need a better message here
            return [false, 'STAR name not understood'];
        }

        const routeStringModel = new RouteModel(routeString);
        const starModel = this._fms.findStarByProcedureId(routeStringModel.procedure);

        // TODO: set mcp modes here
        this._fms.replaceArrivalProcedure(routeStringModel.routeCode, arrivalRunway);

        // Build readback
        const readback = {};
        readback.log = `cleared to ${airportName} via the ${routeStringModel.procedure} arrival`;
        readback.say = `cleared to ${airportName} via the ${starModel.name.toUpperCase()} arrival`;

        return [true, readback];
    }

    /**
     * Apply the specified departure procedure by adding it to the fms route
     * Note: SHOULD NOT change the heading mode
     *
     * @for Pilot
     * @method applyDepartureProcedure
     * @param procedureId {String}      the identifier for the procedure
     * @param departureRunway {String}  the identifier for the runway to use for departure
     * @param airportIcao {string}      airport icao identifier
     * @return {array}                  [success of operation, readback]
     */
    applyDepartureProcedure(procedureId, departureRunway, airportIcao) {
        const standardRouteModel = this._fms.findSidByProcedureId(procedureId);

        if (_isNil(standardRouteModel)) {
            return [false, 'SID name not understood'];
        }

        const exit = this._fms.findRandomExitPointForSidProcedureId(procedureId);
        const routeStr = `${airportIcao}.${procedureId}.${exit}`;

        if (!departureRunway) {
            return [false, 'unsure if we can accept that procedure; we don\'t have a runway assignment'];
        }

        if (!standardRouteModel.hasFixName(departureRunway)) {
            return [false, `unable, the ${standardRouteModel.name.toUpperCase()} departure not valid from Runway ${departureRunway}`];
        }

        this._mcp.setAltitudeVnav();
        this._mcp.setSpeedVnav();
        this._fms.replaceDepartureProcedure(routeStr, departureRunway);

        const readback = {};
        readback.log = `cleared to destination via the ${procedureId} departure, then as filed`;
        readback.say = `cleared to destination via the ${standardRouteModel.name} departure, then as filed`;

        return [true, readback];
    }

    /**
     * Replace the entire route stored in the FMS with legs freshly generated
     * based on the provided route string
     *
     * @for Pilot
     * @method applyNewRoute
     * @param routeString {string}  routeString defining the new route to use
     * @return {array}              [success of operation, readback]
     */
    applyNewRoute(routeString, runway) {
        const isValid = this._fms.isValidRoute(routeString, runway);

        if (!isValid) {
            const readback = {};
            readback.log = `requested route of "${routeString}" is invalid`;
            readback.say = 'that route is invalid';

            return [false, readback];
        }

        this._fms.replaceFlightPlanWithNewRoute(routeString, runway);

        // Build readback
        const readback = {};
        readback.log = `rerouting to: ${this._fms.currentRoute}`;
        readback.say = 'rerouting as requested';

        return [true, readback];
    }

    /**
     * Apply the specified route, and as applicable, merge it with the current route
     *
     * @for Pilot
     * @method applyPartialRouteAmendment
     * @param routeString {tring}  route string in the form of `entry.procedure.airport`
     * @return {array}             [success of operation, readback]
     */
    applyPartialRouteAmendment(routeString) {
        const isValid = this._fms.isValidRoute(routeString);

        if (!isValid) {
            return [false, `requested route of "${routeString}" is invalid`];
        }

        if (!this._fms.isValidRouteAmendment(routeString)) {
            // FIXME: this is not a good message
            return [false, `requested route of "${routeString}" is invalid, it must contain a Waypoint in the current route`];
        }

        this._fms.replaceRouteUpToSharedRouteSegment(routeString);

        // Build readback
        const readback = {};
        readback.log = `rerouting to: ${this._fms.currentRoute}`;
        readback.say = 'rerouting as requested';

        return [true, readback];
    }

    /**
     * Configure the aircraft to fly in accordance with the requested flightplan
     *
     * @for Pilot
     * @method clearedAsFiled
     * @param {Number} initialAltitude  the altitude aircraft can automatically climb to at this airport
     * @param {Number} runwayHeading    the magnetic heading of the runway, in radians
     * @param {Number} cruiseSpeed      the cruise speed of the aircraft, in knots
     * @return {Array}                  [success of operation, readback]
     */
    clearedAsFiled(initialAltitude, runwayHeading, cruiseSpeed) {
        this._mcp.setAltitudeHoldWithValue(initialAltitude);
        this._mcp.setHeadingLnavWithValue(runwayHeading);
        this._mcp.setSpeedN1WithValue(cruiseSpeed);

        const readback = {};
        readback.log = `cleared to destination as filed. Climb and maintain ${initialAltitude}, expect ` +
                `${this._fms.flightPlanAltitude} 10 minutes after departure`;
        readback.say = `cleared to destination as filed. Climb and maintain ${radio_altitude(initialAltitude)}, ` +
                `expect ${radio_altitude(this._fms.flightPlanAltitude)}, ${radio_spellOut('10')} minutes ` +
                'after departure';

        return ['ok', readback];
    }

    /**
     * Climb in accordance with the altitude restrictions, and sets
     * altitude at which the climb will end regardless of fix restrictions.
     *
     * @for Pilot
     * @method climbViaSid
     * @return {array}           [success of operation, readback]
     */
    climbViaSid() {
        if (this._fms.flightPlanAltitude === -1) {
            const readback = {};
            readback.log = 'unable to climb via SID, no altitude assigned';
            readback.say = 'unable to climb via SID, no altitude assigned';

            return [false, readback];
        }

        this._mcp.setAltitudeVnavWithValue(this._fms.flightPlanAltitude);

        const readback = {};
        readback.log = 'climb via SID';
        readback.say = 'climb via SID';

        return [true, readback];
    }

    /**
     * Descend in accordance with the altitude restrictions
     *
     * @for Pilot
     * @method descendViaSTAR
     * @param altitude {number}  (optional) altitude at which the descent will end (regardless of fix restrictions)
     *                                      this should be the altitude of the lowest fix restriction on the STAR
     * @return {array}           [success of operation, readback]
     */
    descendViaSTAR(altitude = 0) {
        this._mcp.setAltitudeFieldValue(altitude);
        this._mcp.setAltitudeVnav();
        this._mcp.setSpeedVnav();

        // Build readback
        const readback = {};
        readback.log = 'descend via the arrival';
        readback.say = 'descend via the arrival';

        return [true, readback];
    }

    /**
     * Intercept a radial course or localizer (horizontal guidance)
     *
     * @for Pilot
     * @method interceptCourse
     * @param {Position} datum - the position the course is based upon
     * @param {Number} course - the heading inbound to the datum
     * @return {Array} [success of operation, readback]
     */
    interceptCourse(datum, course) {
        this._setNav1Datum(datum);
        this._mcp.setCourseFieldValue(course);
        this._mcp.setHeadingVorLoc();

        const readback = {};
        readback.log = 'intercept localizer';
        readback.say = 'intercept localizer';

        return [true, readback];
    }

    /**
     * Intercept a glidepath or glideslop (vertical guidance)
     *
     * @for Pilot
     * @method interceptGlidepath
     * @param {Position} datum - the position the glidepath is projected from
     * @param {Number} course - the heading inbound to the datum
     * @param {Number} descentAngle - the angle of descent along the glidepath
     * @param {Number} interceptAltitude - the altitude to which the aircraft can descend without yet
     *                                     being established on the glidepath
     * @return {Array} [success of operation, readback]
     */
    interceptGlidepath(datum, course, descentAngle, interceptAltitude) {
        // TODO: I feel like our description of lateral/vertical guidance should be done with its
        // own class rather than like this by storing all sorts of irrelevant stuff in the pilot/MCP.
        if (this._mcp.nav1Datum !== datum) {
            return [false, 'cannot follow glidepath because we are using lateral navigation from a different origin'];
        }

        if (this._mcp.course !== course) {
            return [
                false,
                'cannot follow glidepath because its course differs from that specified for lateral guidance'
            ];
        }

        // TODO: the descentAngle is a part of the ILS system itself, and should not be owned by the MCP
        this._mcp.descentAngle = descentAngle;
        this._mcp.setAltitudeFieldValue(interceptAltitude);
        this._mcp.setAltitudeApproach();

        const readback = {};
        readback.log = 'intercept glidepath';
        readback.log = 'intercept glidepath';

        return [true, readback];
    }

    /**
     * Conduct the specified instrument approachType
     * Note: Currently only supports ILS approaches
     * Note: Approach variants cannot yet be specified (eg RNAV-Y)
     *
     * @for pilot
     * @method conductInstrumentApproach
     * @param {String} approachType - the type of instrument approach (eg 'ILS', 'RNAV', 'VOR', etc)
     * @param {Runway} runway - the runway the approach ends at
     * @param {Number} interceptAltitude - the altitude to maintain until established on the localizer
     * @return {Array} [success of operation, readback]
     */
    conductInstrumentApproach(approachType, runway, interceptAltitude) {
        if (_isNil(runway)) {
            return [false, 'the specified runway does not exist'];
        }

        // TODO: #flyPresentHeading requires a value we can't get, unless we pass it, which seems sloppy
        if (this._mcp.headingMode !== MCP_MODE.HEADING.HOLD) {
            this.flyPresentHeading();
        }

        const datum = runway.position;
        const course = runway.angle;
        const descentAngle = runway.ils.gs_gradient;

        // TODO: This method may not exist yet
        this._fms.setArrivalRunway(runway.name);

        const lateralGuidance = this.interceptCourse(datum, course)[0];
        const verticalGuidance = this.interceptGlidepath(datum, course, descentAngle, interceptAltitude)[0];

        if (!lateralGuidance) {
            return lateralGuidance;
        }

        if (!verticalGuidance) {
            return verticalGuidance;
        }

        const readback = {};
        readback.log = `cleared ${approachType.toUpperCase()} runway ${runway.name} approach`;
        readback.say = `cleared ${approachType.toUpperCase()} runway ${radio_runway(runway.name)} approach`;

        return [true, readback];
    }

    /**
     * Expedite the climb or descent to the assigned altitude, to use maximum possible rate
     *
     * @for Pilot
     * @method shouldExpediteAltitudeChange
     */
    shouldExpediteAltitudeChange() {
        this._mcp.shouldExpediteAltitudeChange = true;

        return [true, 'expediting to assigned altitude'];
    }

    /**
     * Skip ahead in the FMS to the waypoint for the specified fixName, and activate LNAV to fly to it
     *
     * @for Pilot
     * @method proceedDirect
     * @param {String} fixName - name of the fix we are flying direct to
     * @return {Array} [success of operation, readback]
     */
    proceedDirect(fixName) {
        // TODO: Update #skipToWaypoint so it tells us whether it found and skipped anything or not
        this._fms.skipToWaypoint(fixName);
        this._setHeadingLnav();

        return [true, `proceed direct ${fixName}`];
    }

    /**
     * Return the route of the aircraft
     *
     * @for AircraftCommander
     * @method sayRoute
     * @return {Array} [success of operation, readback]
     */
    sayRoute() {
        const readback = {};
        readback.log = `route: ${this._fms.currentRoute}`;
        readback.say = 'here\'s our route';

        return [true, readback];
    }

    /**
     * Return the altitude the aircraft is currently assigned. May be moving toward this altitude,
     * or already established at that altitude.
     *
     * @for Pilot
     * @method sayTargetedAltitude
     */
    sayTargetedAltitude() {
        return this._mcp.altitude;
    }

    /**
     * Return the heading the aircraft is currently targeting. May be moving toward this heading,
     * or already established at that heading.
     *
     * @for Pilot
     * @method sayTargetedHeading
     */
    sayTargetedHeading() {
        switch (this._mcp.headingMode) {
            case MCP_MODE.HEADING.HOLD:
                return this._mcp.heading;

            case MCP_MODE.HEADING.VOR_LOC:
                return this._mcp.course;

            case MCP_MODE.HEADING.LNAV:
                return this._fms.currentWaypoint.heading;

            default:
                return;
        }
    }

    /**
     * Return the speed the aircraft is currently assigned. May be moving toward this speed, or
     * already established at this speed.
     *
     * @for Pilot
     * @method sayTargetedSpeed
     */
    sayTargetedSpeed() {
        if (this._mcp.speed === MCP_MODE.SPEED.VNAV) {
            return this._fms.currentWaypoint.speed;
        }

        return this._mcp.speed;
    }

    /**
     * Taxi the aircraft
     *
     * @for Pilot
     * @method taxi
     * @param {String} taxiDestination - currently expected to be a runway
     * @param {Boolean} isDeparture - whether the aircraft's flightPhase is "DEPARTURE"
     * @param {Boolean} isOnGround - whether the aircraft is on the ground
     * @param {String} flightPhase - the flight phase of the aircraft
     * @return {Array} [success of operation, readback]
     */
    taxi(taxiDestination, isDeparture, isOnGround, flightPhase) {
        // TODO: all this if logic should be simplified or abstracted
        // TODO: isDeparture and flightPhase can be combined
        if (!isDeparture) {
            return [false, 'unable to taxi, we are an arrival'];
        }

        if (flightPhase === FLIGHT_MODES.TAXI) {
            return [false, 'already taxiing'];
        }

        if (flightPhase === FLIGHT_MODES.WAITING) {
            return [false, 'already taxiied, and waiting in runway queue'];
        }

        if (flightPhase !== FLIGHT_MODES.APRON) {
            return [false, 'unable to taxi'];
        }

        // Set the runway to taxi to
        if (!taxiDestination) {
            // TODO: This method may not yet exist
            taxiDestination = window.airportController.airport_get().runway;
        }

        if (!this._airportController.airport_get().getRunway(taxiDestination)) {
            return [false, `no runway ${taxiDestination.toUpperCase()}`];
        }

        this._fms.setDepartureRunway(taxiDestination);

        // TODO: Figure out what to do with this
        // // Start the taxi
        // aircraft.taxi_start = this._gameController.game_time();
        const runway = this._airportController.airport_get().getRunway(taxiDestination);
        // runway.addAircraftToQueue(aircraft);
        // aircraft.mode = FLIGHT_MODES.TAXI;

        const readback = {};
        readback.log = `taxi to runway ${runway.name}`;
        readback.say = `taxi to runway ${radio_runway(runway.name)}`;

        return [true, readback];
    }
}