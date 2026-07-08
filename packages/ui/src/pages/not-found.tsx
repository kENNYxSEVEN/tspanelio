import { ArrowLeft, SearchX } from "lucide-react"
import { Link, useLocation, useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export function NotFound() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <SearchX className="size-5" />
            </div>
            <div>
              <CardTitle>Page not found</CardTitle>
              <CardDescription>
                The page you are looking for does not exist.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            Requested path:{" "}
            <span className="font-mono text-foreground">
              {location.pathname}
              {location.search}
            </span>
          </div>
        </CardContent>
        <CardFooter className="flex-wrap justify-end gap-2 max-sm:[&>*]:w-full">
          <Button asChild>
            <Link to="/servers">Go to Server List</Link>
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate(-1)}>
            <ArrowLeft className="size-4" />
            Go back
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
