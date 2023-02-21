import type { Libp2pOptions } from 'libp2p';
import type { GossipsubEvents } from '@chainsafe/libp2p-gossipsub';
import type { PubSub, SignedMessage } from '@libp2p/interface-pubsub';
import files from './files';

async function start(
  privKey: string,
  bootstraps: string[],
  swarmKey: string,
): Promise<boolean> {
  const { createLibp2p } = await import('libp2p');
  const { bootstrap } = await import('@libp2p/bootstrap');
  const { tcp } = await import('@libp2p/tcp');
  const { mplex } = await import('@libp2p/mplex');
  const { noise } = await import('@chainsafe/libp2p-noise');
  const { unmarshalPrivateKey } = await import('@libp2p/crypto/keys');
  const { createFromPrivKey } = await import('@libp2p/peer-id-factory');
  const { preSharedKey } = await import('libp2p/pnet');
  const { gossipsub } = await import('@chainsafe/libp2p-gossipsub');
  const { pubsubPeerDiscovery } = await import('@libp2p/pubsub-peer-discovery');
  const { logger } = await import('@libp2p/logger');
  const uint8ArrayToString = (await import('uint8arrays/to-string')).toString;
  const uint8ArrayFromString = (await import('uint8arrays/from-string')).fromString;

  const log = logger('i2kn:api:libp2p');
  log('libp2p starting');

  // create PeerId from privateKey (required to sign messages)
  const privKeyBuffer = uint8ArrayFromString(privKey, 'base64pad');
  const PK = await unmarshalPrivateKey(privKeyBuffer);
  const myPeerId = await createFromPrivKey(PK);

  const connectionProtector = preSharedKey({
    psk: new Uint8Array(Buffer.from(swarmKey, 'base64')),
  });

  const p2pOptions: Libp2pOptions = {
    peerId: myPeerId,
    addresses: {
      listen: [
        '/ip4/0.0.0.0/tcp/64000',
      ],
    },
    transports: [
      tcp(),
    ],
    peerDiscovery: [
      pubsubPeerDiscovery(),
    ],
    streamMuxers: [mplex()],
    connectionEncryption: [noise()],
    pubsub: gossipsub({
      allowPublishToZeroPeers: true,
    }),
    connectionProtector,
  };

  // Add boostraps nodes if any
  bootstraps = bootstraps.filter((b) => b.length > 0);
  if (bootstraps && bootstraps.length) {
    p2pOptions.peerDiscovery?.push(bootstrap({
      list: bootstraps,
    }));
    log('add boostraps %o', bootstraps);
  }

  // if (isMasternode) {
  //   // https://github.com/libp2p/js-libp2p/tree/master/examples/auto-relay
  //   // p2pOptions.relay = {
  //   //   enabled: true,
  //   //   hop: {
  //   //     enabled: true,
  //   //     active: true,
  //   //   },
  //   //   advertise: {
  //   //     bootDelay: 15 * 60 * 1000,
  //   //     enabled: true,
  //   //     ttl: 30 * 60 * 1000,
  //   //   },
  //   // };
  //   p2pOptions.addresses.listen.push('/ip4/0.0.0.0/tcp/15555/ws/p2p-webrtc-star');
  // }

  const libp2pnode = await createLibp2p(p2pOptions);

  // gossipsub
  libp2pnode.pubsub.subscribe('I2KNV3');

  // handle
  /*
  const { pipe } = await import('it-pipe');
  const uint8ArrayToString = (await import('uint8arrays/to-string')).toString;
  await libp2pnode.handle(handle, ({ stream }) => {
    pipe(
      stream,
      async (source) => {
        let message = '';
        // eslint-disable-next-line no-restricted-syntax
        for await (const msg of source) {
          message += uint8ArrayToString(msg.subarray());
        }
        log('handle msg received', handle, message);
      },
    );
  });
  */

  libp2pnode.addEventListener('peer:discovery', (evt) => {
    const { detail: peer } = evt;
    log('libp2p.onPeerDiscovery', peer.id.toString());
  });

  libp2pnode.addEventListener('peer:connect', async (evt) => {
    const { detail: connection } = evt;
    const { remotePeer } = connection;
    const remotePeerId = remotePeer.toString();
    log('libp2p.onPeerConnected', remotePeerId);
  });

  libp2pnode.addEventListener('peer:disconnect', (evt) => {
    const { detail: connection } = evt;
    const { remotePeer } = connection;
    const remotePeerId = remotePeer.toString();
    log('libp2p.onPeerDisconnected', remotePeerId);
  });

  (libp2pnode.pubsub as PubSub<GossipsubEvents>).addEventListener('gossipsub:message', async (evt) => {
    const uint8ArrayToString = (await import('uint8arrays/to-string')).toString;
    const msg = evt.detail.msg as SignedMessage;
    if (msg.topic !== 'I2KNV3') return;

    const from = msg.from.toString();
    const data = uint8ArrayToString(msg.data);
    log('gossipsub message', from, data);
  });


  await libp2pnode.start();

  if (libp2pnode.isStarted() === false) return false;
  log('libp2p started');

  const multiAddrs = libp2pnode.getMultiaddrs();
  console.log(multiAddrs.map((m) => m.toString()));

  return true;
}

start(
  'CAASpwkwggSjAgEAAoIBAQCZ8y9zRJUZCDzusYsXUoNL27BD6//9uWTzX1GljEjFShrwf6sgV76YwGT/kc4svdySzae+l/TxotI2/r1pk1vhOfg5gYqxQ3mmezu/Vu+tC0Djh6FaW/PJ5RuV/C2C407uTsd76osERV2bCzkIDSwjaOiq6cKctv+Se8CvQstouaMSDuYZPM1kJbrBqVix3gr+yCeAPOlVw82l9PEeri7xpeI9R7IMJq43NRnZAzsFhKbYvPhyRSIkQjcgrPic65NNplDb8fm/TlTjsPy5gbKqEH4J8T32BT+Z6AJi4w2ei0YoW6x5fKVvAMarNSBhxR0DCJAii3IPsVSjL7VWAibJAgMBAAECggEADNECEkaTYxIcgIKnYbms1JPliMIM/cKBdQFqeq3DISmaNItsY7TqWS0rO1uYHoFv64jTfjqIWdWESq/KdQ+fhpCc6ayvLzK+3e1EfBlwuqdFL6wK8srU8Onx8fqcj1j9KTnFwbs095YOxOmaReFS21/QfuoXGZTikf9bezvEU2N/5FRPLP7CAksaNsOk7pL5ma9HQs1KmsiEZGmBeubyqJSXHPGub6iBlNhRRA7g3WJBuqf0+xrI9StPQbP1yBsdWe8QtFDtkRc/eoMWsrLeGpGTBjonfRQkt4Nuj/8vuUlKH+9uSF1vvOO/UypW8GkFKA59tZu7D2Fwh6vnzaRhAQKBgQDSGNo6MtzO03EpgVOFx4aQ1QyND6HD22WRBWOOwNHSRks7LiGzLT5awAhS62/voyqbNlu5Dz4ul/IXU+uqbJmiA5rA9HA7R/+8iA9Lhm2MXM2PgMDXgJ4aFzBdMrOwPwFV/gbmsajHb0HnxgOKuwbrxGaGW1zsDZQ0r0BOxsKoJQKBgQC7lelvB4ESySVXW3ZOrqmsnm47v/hb5xPz8z9HIihM7RQZGT78jkDauMZkAFZBDJ8njmgFb8z0TQ0Z7yNM3zLoCybXELh1jNo0bYdcGFquTgb8bwu4sysA7bCahF9svbVSFByNHBxO4A0f4nzvPCQH52B0MJeYQVbvenvP9wdA1QKBgQCGR8oazm1gZ7X5ACaA56CzKugltGsAwlYtFVOnZsf0bGcjAP4bBfzHhdsMHFxjvla580k2g26L2yOpE0MZnuWmrkUXtGOTEBZ8yj10WQvlXV8oq/MVCaiDJnUL7B76s5pH+t8wTTaBmTN3TpDu91CaGeIpV3WRjbA+6A/jCZhaXQKBgDxghiAMhEjtoS067RtqMIa0/7oPkfrSp6NvecCFh/8ql7t0WsejadB8hK6PRTPuwhNTTLvjPk6rtjnQtMX7WUFCxZ+XbCe5zEnvrw+/bwCHcMwzWcx7Lq4/0wYI8UXo0cG3Y3EvyRTCHLdUiO3fp6E7odoEAecpsLen7s4DLrx5AoGAJK1s5UnpGBeSlGJBkxsBuHPEYVP9gaMzrgcw0+vZKJJLFeAtJ+QsRQnztFE+y1SuzkwOcpeOlvSYEYV286BpkdhMi1V6Vd7paj7bUXltLEUlhJ8wGddnLz58OhBhsm812JIpX8BVx7EfvDzUGwrrRBLQ3bPNe/vqr2MjOrgQyYM=',
  [],
  'L2tleS9zd2FybS9wc2svMS4wLjAvCi9iYXNlMTYvCjA1OTQ1NGQxNzAwNmIzM2NmYmVlNDgwM2QxOTk3YTYxODc4N2I4MzQ3YjVhOGVjM2YzMzVkNWE2NWU4MTU2YmI=',
);
