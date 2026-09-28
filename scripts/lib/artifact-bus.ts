/**
 * Backward-compatible public entrypoint.
 *
 * The filesystem artifact bus is dispatch-domain code (T12 fold, KTD36). It used
 * to live here and reach the domain through a `resources/` byte mirror; the
 * mirror is retired, so the implementation moved once and this file re-exports it.
 */

export {
  busDir,
  busLogPath,
  casMetaPath,
  subscriberPath,
  sha256,
  isValidTopic,
  topicType,
  matchTopic,
  validateBusEventV1,
  validateCasMetaV1,
  validateBusSubscriberV1,
  casPut,
  refCount,
  casGet,
  casVerify,
  lastBusPublishRefusal,
  publish,
  readBusLog,
  tailBusLog,
  registerSubscriber,
  readSubscribers,
  fanout,
  processFanout,
  BUS_EVENT_SCHEMA,
  CAS_META_SCHEMA,
  BUS_SUBSCRIBER_SCHEMA,
  TOPIC_TYPES,
  type TopicType,
  BUS_EVENT_KINDS,
  type BusEventKind,
  type SubscriberCallback,
  type BusPublisher,
  type BusEventV1,
  type CasMetaV1,
  type BusSubscriberV1,
  BusLockTimeout,
  type PublishInput,
} from "../../src/domains/dispatch/index";
