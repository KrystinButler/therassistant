import {
  useEffect,
  useState,
} from "react";

import {
  Link,
} from "wouter";

import {
  parseApiResponse,
} from "../lib/therassistant-api";


const DEFAULT_TENANT =
  "10000000-0000-4000-8000-000000000002";


type Tenant = {
  id: string;
  name: string;
  tenantType: string;
  status: string;
  clientCount: number;
  providerCount: number;
  claimCount: number;
};


export function DemoTopControls() {
  const [
    tenants,
    setTenants,
  ] =
    useState<Tenant[]>([]);


  const [
    selected,
    setSelected,
  ] =
    useState(
      () =>
        window.localStorage
          .getItem(
            "therassistant-demo-tenant-id",
          )
        ||
        DEFAULT_TENANT,
    );


  useEffect(
    () => {
      let active =
        true;


      void fetch(
        "/api/demo-control/tenants",
      )
        .then(
          (response) =>
            parseApiResponse<Tenant[]>(
              response,
            ),
        )
        .then(
          (
            result:
              Tenant[],
          ) => {
            if (active) {
              setTenants(
                result,
              );
            }
          },
        )
        .catch(
          (error) => {
            console.error(
              error,
            );
          },
        );


      return () => {
        active =
          false;
      };
    },
    [],
  );


  function changeTenant(
    id: string,
  ) {
    setSelected(id);

    window.localStorage
      .setItem(
        "therassistant-demo-tenant-id",
        id,
      );


    window.dispatchEvent(
      new CustomEvent(
        "therassistant-tenant-change",
        {
          detail: {
            tenantId:
              id,
          },
        },
      ),
    );


    window.location.href =
      "/demo";
  }


  return (
    <div className="thera-demo-controls">
      <div className="thera-demo-control-label">
        Demo Workspace
      </div>

      <select
        value={selected}
        onChange={(event) =>
          changeTenant(
            event.target.value,
          )
        }
        aria-label="Demo workspace"
      >
        {tenants.map(
          (tenant) => (
            <option
              key={tenant.id}
              value={tenant.id}
            >
              {tenant.name}
            </option>
          ),
        )}
      </select>

      <Link
        href="/demo"
        className="thera-demo-start-button"
      >
        Start Demo
      </Link>
    </div>
  );
}
