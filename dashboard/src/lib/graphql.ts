import { SuiGraphQLClient } from '@mysten/sui/graphql'
export { graphql } from '@mysten/sui/graphql/schema'
import { GRAPHQL_URL } from './constants'

export const gqlClient = new SuiGraphQLClient({
  network: 'testnet',
  url: GRAPHQL_URL,
})
