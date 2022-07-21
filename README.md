# ljm-jaas-example
This repo serves as a reference for JaaS customers in regard to implementing the integration with the Jitsi Meet server side video conferencing [service](https://github.com/jitsi/lib-jitsi-meet).

## Implementation details
### buildOptions
Prepares the connection configuration.

### connect
Uses the provided [configuration](#buildoptions) to create a new connection object and the local tracks for it. The connection status event handlers can be attached here.

#### CONNECTION_ESTABLISHED handler
Initializes the conference, adds the remote tracks and the conference event handlers, and joins the room.

#### CONNECTION_FAILED handler
Handles failures and can attempt reconnections.

#### CONNECTION_DISCONNECTED handler
Handles the cleanup and disconnects the client from the server.

## Example settings
### region
Optional. The region of the media server.
### tenant
Required. The JaaS tenant value.
### room
Required. The name of the room.
### jwt
Optional. The authentication token.
### release version
Optional. The lib-jitsi-meet script is versioned for testing purposes.
### stage
Optional. Whether to use `stage.8x8.vc`.

Changes to the [release version](#release-version) and [stage](#stage) values during an already established connection require using the reload button in order to apply the latest lib-jitsi-meet script. For the rest of the inputs, please hang up and rejoin.