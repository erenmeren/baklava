import PostreSQLForm from "../../forms/postgreSQLForm"
import { Icons } from "../../icons"
import { Button } from "../../ui/button"

type Props = {
  refreshMenu: () => void
  isLoading: boolean
  isFetching: boolean
  memoizedMenuProps: any
  MemorizedMenu: any
}

const DatabaseMenu: React.FC<Props> = ({
  refreshMenu,
  isLoading,
  isFetching,
  memoizedMenuProps,
  MemorizedMenu,
}) => {
  return (
    <div className="px-6">
      <div className="flex justify-between pt-4 ">
        <span className="mt-2 font-semibold">Connections</span>

        <div className="flex">
          <PostreSQLForm
            formTrigger={
              <Button variant="ghost" size="icon">
                <Icons.plus className="h-4 w-4" />
              </Button>
            }
          />
          <Button variant="ghost" size="icon" onClick={refreshMenu}>
            <Icons.refresh className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="">
        {isLoading && isFetching ? "Loading ..." : <MemorizedMenu {...memoizedMenuProps} />}
      </div>
    </div>
  )
}

export default DatabaseMenu
