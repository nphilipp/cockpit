/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "mock-auth.h"

#include "cockpit/cockpitenums.h"
#include "cockpit/cockpiterror.h"

#include <string.h>

struct _MockAuth {
  CockpitAuth parent;
  gchar *expect_user;
  gchar *expect_password;
};

typedef struct _CockpitAuthClass MockAuthClass;

G_DEFINE_TYPE (MockAuth, mock_auth, COCKPIT_TYPE_AUTH)

static void
mock_auth_init (MockAuth *self)
{

}

static void
mock_auth_finalize (GObject *obj)
{
  MockAuth *self = MOCK_AUTH (obj);
  g_free (self->expect_user);
  g_free (self->expect_password);
  G_OBJECT_CLASS (mock_auth_parent_class)->finalize (obj);
}

static void
mock_auth_login_async (CockpitAuth *auth,
                       GHashTable *headers,
                       GBytes *input,
                       const gchar *remote_peer,
                       GAsyncReadyCallback callback,
                       gpointer user_data)
{
  MockAuth *self = MOCK_AUTH (auth);
  GSimpleAsyncResult *result;
  gsize expect_len;
  GBytes *password = NULL;
  gchar *user = NULL;
  GError *error = NULL;

  result = g_simple_async_result_new (G_OBJECT (auth), callback, user_data, NULL);
  g_simple_async_result_set_op_res_gpointer (result, g_strdup (remote_peer), g_free);

  expect_len = strlen (self->expect_password);
  if (!cockpit_auth_parse_input (input, &user, &password, &error))
    {
      g_simple_async_result_take_error (result, error);
    }
  else if (!g_str_equal (user, self->expect_user) ||
           g_bytes_get_size (password) != expect_len ||
           memcmp (g_bytes_get_data (password, NULL), self->expect_password, expect_len) != 0)
    {
      g_simple_async_result_set_error (result, COCKPIT_ERROR,
                                       COCKPIT_ERROR_AUTHENTICATION_FAILED,
                                       "Authentication failed");
    }

  g_simple_async_result_complete_in_idle (result);
  g_object_unref (result);

  g_free (user);
  if (password)
    g_bytes_unref (password);
}

static CockpitCreds *
mock_auth_login_finish (CockpitAuth *auth,
                        GAsyncResult *async,
                        GError **error)
{
  MockAuth *self = MOCK_AUTH (auth);
  GSimpleAsyncResult *result = G_SIMPLE_ASYNC_RESULT (async);

  if (g_simple_async_result_propagate_error (result, error))
      return NULL;

  return cockpit_creds_new (self->expect_user,
                            COCKPIT_CRED_PASSWORD, self->expect_password,
                            COCKPIT_CRED_RHOST, g_simple_async_result_get_op_res_gpointer (result),
                            NULL);
}

static void
mock_auth_class_init (MockAuthClass *klass)
{
  GObjectClass *object_class = G_OBJECT_CLASS (klass);

  klass->login_async = mock_auth_login_async;
  klass->login_finish = mock_auth_login_finish;
  object_class->finalize = mock_auth_finalize;
}

CockpitAuth *
mock_auth_new (const char *expect_user,
               const char *expect_password)
{
  MockAuth *self;

  g_assert (expect_user != NULL);
  g_assert (expect_password != NULL);

  self = g_object_new (MOCK_TYPE_AUTH, NULL);
  self->expect_user = g_strdup (expect_user);
  self->expect_password = g_strdup (expect_password);

  return COCKPIT_AUTH (self);
}
